use std::hint::black_box;
use std::time::Instant;

use ruseact_core::{ComputationId, ReactiveGraph, Signal};

const TRIALS: usize = 5;
const WARMUPS: usize = 2;
const SIZES: [usize; 3] = [16, 64, 256];
const REPEATED_OPERATIONS: usize = 1_000;

struct Fixture {
    graph: ReactiveGraph,
    signals: Vec<Signal<u64>>,
    computations: Vec<ComputationId>,
    edges: Vec<(usize, usize)>,
}

struct SingleSignalFixture {
    graph: ReactiveGraph,
    signal: Signal<u64>,
}

struct ReplacementFixture {
    graph: ReactiveGraph,
    computation: ComputationId,
    replacements: Vec<Vec<ruseact_core::NodeId>>,
}

fn build_fixture(size: usize, degree: usize, connect: bool) -> Fixture {
    let mut graph = ReactiveGraph::new();
    let signals: Vec<_> = (0..size)
        .map(|value| graph.create_signal(value as u64).unwrap())
        .collect();
    let computation_count = (size / 4).max(1);
    let computations: Vec<_> = (0..computation_count)
        .map(|_| graph.create_computation().unwrap())
        .collect();
    let mut edges = Vec::with_capacity(computation_count * degree);

    for computation_index in 0..computation_count {
        for offset in 0..degree {
            edges.push((
                (computation_index * degree + offset) % size,
                computation_index,
            ));
        }
    }

    if connect {
        for &(signal_index, computation_index) in &edges {
            graph
                .subscribe(signals[signal_index], computations[computation_index])
                .unwrap();
        }
    }

    Fixture {
        graph,
        signals,
        computations,
        edges,
    }
}

fn build_replacement_fixture(size: usize) -> ReplacementFixture {
    let mut graph = ReactiveGraph::new();
    let signals: Vec<_> = (0..size)
        .map(|value| graph.create_signal(value as u64).unwrap())
        .collect();
    let computation = graph.create_computation().unwrap();
    let replacements = (0..REPEATED_OPERATIONS)
        .map(|iteration| {
            (0..8)
                .map(|offset| signals[(iteration + offset * 13) % size].id())
                .collect()
        })
        .collect();

    ReplacementFixture {
        graph,
        computation,
        replacements,
    }
}

fn measure_case<T, Setup, Operation>(
    operation: &str,
    size: usize,
    edges: usize,
    affected: usize,
    operations: usize,
    mut setup: Setup,
    mut operation_fn: Operation,
) where
    Setup: FnMut() -> T,
    Operation: FnMut(&mut T) -> usize,
{
    for _ in 0..WARMUPS {
        let mut state = setup();
        black_box(operation_fn(&mut state));
    }

    let mut elapsed_nanos = Vec::with_capacity(TRIALS);
    for _ in 0..TRIALS {
        let mut state = setup();
        let started = Instant::now();
        black_box(operation_fn(&mut state));
        elapsed_nanos.push(started.elapsed().as_nanos());
    }

    elapsed_nanos.sort_unstable();
    let median = elapsed_nanos[TRIALS / 2];
    let p95_index = (TRIALS * 95).div_ceil(100) - 1;
    let p95 = elapsed_nanos[p95_index];
    let nanos_per_operation = median as f64 / operations as f64;
    let operations_per_second = operations as f64 * 1_000_000_000.0 / median as f64;

    println!(
        "{operation},{size},{edges},{affected},{operations},{TRIALS},{WARMUPS},{median},{p95},{nanos_per_operation:.2},{operations_per_second:.2}"
    );
}

fn main() {
    println!("# RustReactiveCore M1.5 native baseline");
    println!("# trials={TRIALS} warmups={WARMUPS}");
    println!(
        "operation,size,dependency_edges,affected_computations,operations,trials,warmups,median_ns,p95_ns,median_ns_per_operation,median_operations_per_second"
    );

    for size in SIZES {
        measure_case(
            "signal_creation",
            size,
            0,
            0,
            size,
            ReactiveGraph::new,
            |graph| {
                let mut last = None;
                for value in 0..size {
                    last = Some(graph.create_signal(value as u64).unwrap());
                }
                black_box(last.map(|signal| signal.id()));
                size
            },
        );

        measure_case(
            "signal_read",
            size,
            0,
            0,
            size * 128,
            || build_fixture(size, 0, false),
            |fixture| {
                let mut checksum = 0_u64;
                for _ in 0..128 {
                    for signal in &fixture.signals {
                        checksum = checksum.wrapping_add(*fixture.graph.read(*signal).unwrap());
                    }
                }
                black_box(checksum);
                size * 128
            },
        );

        for (operation, unchanged) in [
            ("changed_signal_write", false),
            ("unchanged_signal_write", true),
        ] {
            measure_case(
                operation,
                size,
                0,
                0,
                REPEATED_OPERATIONS,
                || {
                    let mut graph = ReactiveGraph::new();
                    let signal = graph.create_signal(0_u64).unwrap();
                    SingleSignalFixture { graph, signal }
                },
                |fixture| {
                    let mut changed = 0;
                    for iteration in 0..REPEATED_OPERATIONS {
                        let value = if unchanged { 0 } else { iteration as u64 + 1 };
                        if matches!(
                            fixture.graph.set(fixture.signal, value).unwrap(),
                            ruseact_core::SignalUpdate::Changed
                        ) {
                            changed += 1;
                        }
                    }
                    black_box(changed);
                    REPEATED_OPERATIONS
                },
            );
        }

        measure_case(
            "subscription_registration",
            size,
            size,
            0,
            size,
            || build_fixture(size, 4, false),
            |fixture| {
                for &(signal_index, computation_index) in &fixture.edges {
                    fixture
                        .graph
                        .subscribe(
                            fixture.signals[signal_index],
                            fixture.computations[computation_index],
                        )
                        .unwrap();
                }
                fixture.edges.len()
            },
        );

        measure_case(
            "unsubscription",
            size,
            size,
            0,
            size,
            || build_fixture(size, 4, true),
            |fixture| {
                for &(signal_index, computation_index) in &fixture.edges {
                    fixture
                        .graph
                        .unsubscribe(
                            fixture.signals[signal_index],
                            fixture.computations[computation_index],
                        )
                        .unwrap();
                }
                fixture.edges.len()
            },
        );

        measure_case(
            "dependency_replacement",
            size,
            8,
            0,
            REPEATED_OPERATIONS,
            || build_replacement_fixture(size),
            |fixture| {
                for replacement in &fixture.replacements {
                    fixture
                        .graph
                        .replace_dependencies(fixture.computation, replacement)
                        .unwrap();
                }
                fixture.replacements.len()
            },
        );

        let connected = build_fixture(size, 4, true);
        let affected = connected
            .edges
            .iter()
            .filter(|(signal_index, _)| *signal_index == 0)
            .count();
        drop(connected);

        measure_case(
            "dirty_propagation_and_drain",
            size,
            size,
            affected,
            REPEATED_OPERATIONS * 2,
            || build_fixture(size, 4, true),
            |fixture| {
                let mut drained = 0;
                for iteration in 0..REPEATED_OPERATIONS {
                    fixture
                        .graph
                        .set(fixture.signals[0], iteration as u64 + 1)
                        .unwrap();
                    drained += fixture.graph.drain_pending_computations().len();
                }
                black_box(drained);
                REPEATED_OPERATIONS * 2
            },
        );

        measure_case(
            "pending_queue_drain",
            size,
            size,
            affected,
            affected,
            || {
                let mut fixture = build_fixture(size, 4, true);
                fixture.graph.set(fixture.signals[0], u64::MAX).unwrap();
                fixture
            },
            |fixture| {
                let drained = fixture.graph.drain_pending_computations().len();
                black_box(drained);
                drained
            },
        );

        measure_case(
            "batched_signal_updates",
            size,
            size,
            affected,
            REPEATED_OPERATIONS * 11,
            || build_fixture(size, 4, true),
            |fixture| {
                let updates = size.min(8);
                let mut drained = 0;
                for iteration in 0..REPEATED_OPERATIONS {
                    fixture.graph.begin_batch().unwrap();
                    for signal_index in 0..updates {
                        fixture
                            .graph
                            .set(
                                fixture.signals[signal_index],
                                (iteration + signal_index + 1) as u64,
                            )
                            .unwrap();
                    }
                    fixture.graph.end_batch().unwrap();
                    drained += fixture.graph.drain_pending_computations().len();
                }
                black_box(drained);
                REPEATED_OPERATIONS * (updates + 3)
            },
        );

        measure_case(
            "computation_disposal_cleanup",
            size,
            size,
            1,
            REPEATED_OPERATIONS * 5,
            || {
                let fixture = build_fixture(size, 4, true);
                (fixture, 0_usize)
            },
            |state| {
                let (fixture, current_index) = state;
                let mut current = fixture.computations[*current_index];
                for iteration in 0..REPEATED_OPERATIONS {
                    fixture
                        .graph
                        .set(fixture.signals[0], iteration as u64 + 1)
                        .unwrap();
                    fixture.graph.dispose_computation(current).unwrap();
                    current = fixture.graph.create_computation().unwrap();
                    fixture
                        .graph
                        .subscribe(fixture.signals[0], current)
                        .unwrap();
                    black_box(fixture.graph.drain_pending_computations().len());
                }
                *current_index = 0;
                REPEATED_OPERATIONS * 5
            },
        );
    }
}
