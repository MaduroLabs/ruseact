import * as ts from "typescript";

export type CompilerDiagnosticCategory = "error";

export interface CompilerSourceLocation {
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

export interface CompilerDiagnostic {
  readonly category: CompilerDiagnosticCategory;
  readonly code: string;
  readonly message: string;
  readonly location: CompilerSourceLocation;
}

export interface CompilerNodeMetadata {
  readonly id: string;
  readonly kind: "element" | "text";
  readonly location: CompilerSourceLocation;
}

export interface CompilerSlotMetadata {
  readonly id: string;
  readonly kind: "text" | "attribute" | "property" | "listener";
  readonly location: CompilerSourceLocation;
}

export interface CompilerMetadata {
  readonly templateId: string;
  readonly nodes: readonly CompilerNodeMetadata[];
  readonly slots: readonly CompilerSlotMetadata[];
}

export interface CompileOptions {
  readonly fileName?: string;
}

export interface CompileSuccess {
  readonly ok: true;
  readonly code: string;
  readonly metadata: CompilerMetadata;
}

export interface CompileFailure {
  readonly ok: false;
  readonly diagnostics: readonly CompilerDiagnostic[];
}

export type CompileResult = CompileSuccess | CompileFailure;

type BindingKind = "text" | "attribute" | "property";
type SupportedProperty = "value" | "checked" | "disabled";

interface NodePlan {
  readonly id: string;
  readonly kind: "element" | "text";
  readonly parentId?: string;
  readonly sourceNode: ts.Node;
  readonly name?: string;
  readonly text?: string;
  readonly attributes: Array<{ readonly name: string; readonly value: string; readonly sourceNode: ts.Node }>;
  readonly properties: Array<{
    readonly property: SupportedProperty;
    readonly value: string | boolean;
    readonly sourceNode: ts.Node;
  }>;
}

interface BindingPlan {
  readonly kind: BindingKind;
  readonly slot: string;
  readonly targetId: string;
  readonly sourceNode: ts.Node;
  readonly name?: string;
  readonly property?: SupportedProperty;
  readonly dependencies: readonly ts.Expression[];
  readonly evaluator: ts.ArrowFunction | ts.FunctionExpression;
}

interface ListenerPlan {
  readonly id: string;
  readonly targetId: string;
  readonly type: string;
  readonly sourceNode: ts.Node;
  readonly listener: ts.Expression;
  readonly capture: boolean;
}

interface BindingMarker {
  readonly kind: BindingKind;
  readonly dependencies: readonly ts.Expression[];
  readonly evaluator: ts.ArrowFunction | ts.FunctionExpression;
}

interface PlanBuilderContext {
  readonly sourceFile: ts.SourceFile;
  readonly diagnostics: CompilerDiagnostic[];
  readonly nodes: NodePlan[];
  readonly bindings: BindingPlan[];
  readonly listeners: ListenerPlan[];
  readonly nodeMetadata: CompilerNodeMetadata[];
  readonly slotMetadata: CompilerSlotMetadata[];
  nextNode: number;
  nextBinding: number;
  nextListener: number;
}

const factory = ts.factory;
const compilerMarkerObject = "ruseact";
const supportedProperties = new Set<SupportedProperty>(["value", "checked", "disabled"]);

function flattenMessage(message: string | ts.DiagnosticMessageChain): string {
  if (typeof message === "string") {
    return message;
  }
  return message.messageText + (message.next ?? []).map((entry) => `: ${flattenMessage(entry)}`).join("");
}

function locationOf(sourceFile: ts.SourceFile, node: ts.Node): CompilerSourceLocation {
  const start = node.getStart(sourceFile);
  const position = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    fileName: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
    length: Math.max(1, node.getWidth(sourceFile)),
  };
}

function report(
  context: PlanBuilderContext,
  node: ts.Node,
  code: string,
  message: string,
): void {
  context.diagnostics.push({
    category: "error",
    code,
    message,
    location: locationOf(context.sourceFile, node),
  });
}

function hashTemplate(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isSupportedIntrinsicName(name: string): boolean {
  return /^[a-z][a-zA-Z0-9-]*$/.test(name) && name !== "svg" && name !== "math";
}

function jsxTagName(node: ts.JsxTagNameExpression): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  return undefined;
}

function jsxAttributeName(node: ts.JsxAttributeName): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }
  return undefined;
}

function stringLiteralValue(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function booleanLiteralValue(node: ts.Expression): boolean | undefined {
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

function normalizeJsxText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length === 1) {
    return lines[0];
  }
  const normalized: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/[\t ]+/g, " ").trim();
    if (line.length === 0) {
      continue;
    }
    normalized.push(line);
  }
  return normalized.join(" ");
}

function isSimpleDependency(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return isSimpleDependency(node.expression);
  }
  return false;
}

function parseBindingMarker(
  context: PlanBuilderContext,
  node: ts.Expression,
  expectedKind: BindingKind,
): BindingMarker | undefined {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const receiver = node.expression.expression;
  const method = node.expression.name.text;
  if (!ts.isIdentifier(receiver) || receiver.text !== compilerMarkerObject) {
    return undefined;
  }
  if (method !== "bindText" && method !== "bindAttribute" && method !== "bindProperty") {
    report(context, node, "unsupported_binding_marker", `unsupported compiler binding marker ${method}`);
    return undefined;
  }
  const kind = method === "bindText"
    ? "text"
    : method === "bindAttribute"
      ? "attribute"
      : "property";
  if (kind !== expectedKind) {
    report(context, node, "unsupported_binding_kind", `${method} cannot be used for a ${expectedKind} slot`);
    return undefined;
  }
  if (node.arguments.length !== 2 || !ts.isArrayLiteralExpression(node.arguments[0])) {
    report(context, node, "invalid_dependency_marker", `${method} requires a signal array and evaluator function`);
    return undefined;
  }
  const dependencies = node.arguments[0].elements;
  if (dependencies.length === 0 || dependencies.some((dependency) => !ts.isExpression(dependency) || !isSimpleDependency(dependency))) {
    report(context, node, "invalid_dependency", "binding dependencies must be a non-empty array of signal references");
    return undefined;
  }
  const evaluator = node.arguments[1];
  if (!ts.isArrowFunction(evaluator) && !ts.isFunctionExpression(evaluator)) {
    report(context, node, "invalid_binding_evaluator", "binding evaluator must be an arrow or function expression");
    return undefined;
  }
  return { kind, dependencies, evaluator };
}

function addNodeMetadata(context: PlanBuilderContext, node: NodePlan): void {
  context.nodeMetadata.push({
    id: node.id,
    kind: node.kind,
    location: locationOf(context.sourceFile, node.sourceNode),
  });
}

function addSlotMetadata(context: PlanBuilderContext, id: string, kind: CompilerSlotMetadata["kind"], node: ts.Node): void {
  context.slotMetadata.push({ id, kind, location: locationOf(context.sourceFile, node) });
}

function addTextNode(context: PlanBuilderContext, parentId: string | undefined, text: string, sourceNode: ts.Node): string {
  const id = `n${context.nextNode}`;
  context.nextNode += 1;
  const node: NodePlan = {
    id,
    kind: "text",
    ...(parentId === undefined ? {} : { parentId }),
    sourceNode,
    text,
    attributes: [],
    properties: [],
  };
  context.nodes.push(node);
  addNodeMetadata(context, node);
  return id;
}

function addBinding(
  context: PlanBuilderContext,
  marker: BindingMarker,
  targetId: string,
  sourceNode: ts.Node,
  metadataKind: CompilerSlotMetadata["kind"],
  extra: { readonly name?: string; readonly property?: SupportedProperty },
): void {
  const slot = `b${context.nextBinding}`;
  context.nextBinding += 1;
  context.bindings.push({
    kind: marker.kind,
    slot,
    targetId,
    sourceNode,
    ...extra,
    dependencies: marker.dependencies,
    evaluator: marker.evaluator,
  });
  addSlotMetadata(context, slot, metadataKind, sourceNode);
}

function parseStaticOrBindingValue(
  context: PlanBuilderContext,
  node: ts.JsxAttribute,
  expectedKind: BindingKind,
  targetId: string,
  nameOrProperty: { readonly name?: string; readonly property?: SupportedProperty },
): void {
  const attributeName = jsxAttributeName(node.name);
  if (attributeName === undefined) {
    report(context, node.name, "unsupported_attribute_name", "namespaced JSX attributes are not supported");
    return;
  }
  if (node.initializer === undefined) {
    if (expectedKind === "property" && nameOrProperty.property !== "value") {
      const value = true;
      const target = context.nodes.find((candidate) => candidate.id === targetId);
      if (target !== undefined) {
        const property = nameOrProperty.property;
        if (property !== undefined) {
          target.properties.push({ property, value, sourceNode: node });
        }
      }
      return;
    }
    if (expectedKind === "attribute") {
      const target = context.nodes.find((candidate) => candidate.id === targetId);
      if (target !== undefined) {
        target.attributes.push({ name: nameOrProperty.name!, value: "", sourceNode: node });
      }
      return;
    }
    report(context, node, "invalid_static_value", `${attributeName} requires an explicit value`);
    return;
  }

  if (ts.isStringLiteral(node.initializer)) {
    const target = context.nodes.find((candidate) => candidate.id === targetId);
    if (target === undefined) {
      return;
    }
    if (expectedKind === "property") {
      if (nameOrProperty.property !== "value") {
        report(context, node.initializer, "invalid_property_value", `${attributeName} requires a boolean value`);
        return;
      }
      target.properties.push({ property: nameOrProperty.property, value: node.initializer.text, sourceNode: node });
    } else {
      target.attributes.push({ name: nameOrProperty.name!, value: node.initializer.text, sourceNode: node });
    }
    return;
  }

  if (!ts.isJsxExpression(node.initializer) || node.initializer.expression === undefined) {
    report(context, node.initializer, "unsupported_attribute_value", `${attributeName} must use a static literal or explicit binding marker`);
    return;
  }
  const expression = node.initializer.expression;
  const literalString = stringLiteralValue(expression);
  const literalBoolean = booleanLiteralValue(expression);
  const target = context.nodes.find((candidate) => candidate.id === targetId);
  if (target === undefined) {
    return;
  }
  if (literalString !== undefined || literalBoolean !== undefined) {
    if (expectedKind === "property") {
      const property = nameOrProperty.property;
      if (property === "value" && literalString !== undefined) {
        target.properties.push({ property, value: literalString, sourceNode: node });
      } else if (property !== undefined && property !== "value" && literalBoolean !== undefined) {
        target.properties.push({ property, value: literalBoolean, sourceNode: node });
      } else {
        report(context, expression, "invalid_property_value", `${attributeName} has the wrong scalar type`);
      }
    } else if (literalString !== undefined) {
      target.attributes.push({ name: nameOrProperty.name!, value: literalString, sourceNode: node });
    } else {
      report(context, expression, "invalid_attribute_value", `${attributeName} requires a string value`);
    }
    return;
  }
  const marker = parseBindingMarker(context, expression, expectedKind);
  if (marker === undefined) {
    report(context, expression, "implicit_dynamic_binding", `${attributeName} needs an explicit ruseact binding marker`);
    return;
  }
  addBinding(context, marker, targetId, node, expectedKind, nameOrProperty);
}

function parseAttributes(context: PlanBuilderContext, element: ts.JsxElement | ts.JsxSelfClosingElement, targetId: string): void {
  const openingElement = ts.isJsxElement(element) ? element.openingElement : element;
  const attributes = openingElement.attributes.properties;
  for (const attribute of attributes) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      report(context, attribute, "unsupported_spread_attribute", "JSX spread attributes are not supported in M4.3");
      continue;
    }
    const name = jsxAttributeName(attribute.name);
    if (name === undefined) {
      report(context, attribute.name, "unsupported_attribute_name", "namespaced JSX attributes are not supported");
      continue;
    }
    if (/^on[A-Z]/.test(name)) {
      const capture = name.endsWith("Capture");
      const eventSuffix = capture ? name.slice(2, -7) : name.slice(2);
      if (eventSuffix.length === 0 || attribute.initializer === undefined || !ts.isJsxExpression(attribute.initializer) || attribute.initializer.expression === undefined) {
        report(context, attribute, "invalid_event_handler", `${name} needs a JavaScript handler expression`);
        continue;
      }
      const listener = attribute.initializer.expression;
      const id = `l${context.nextListener}`;
      context.nextListener += 1;
      context.listeners.push({
        id,
        targetId,
        type: eventSuffix[0].toLowerCase() + eventSuffix.slice(1),
        sourceNode: attribute,
        listener,
        capture,
      });
      addSlotMetadata(context, id, "listener", attribute);
      continue;
    }

    if (supportedProperties.has(name as SupportedProperty)) {
      parseStaticOrBindingValue(context, attribute, "property", targetId, { property: name as SupportedProperty });
      continue;
    }
    parseStaticOrBindingValue(context, attribute, "attribute", targetId, { name });
  }
}

function parseChild(context: PlanBuilderContext, child: ts.JsxChild, parentId: string): void {
  if (ts.isJsxText(child)) {
    const text = normalizeJsxText(child.text);
    if (text.length > 0) {
      addTextNode(context, parentId, text, child);
    }
    return;
  }
  if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
    parseElement(context, child, parentId);
    return;
  }
  if (ts.isJsxExpression(child)) {
    if (child.expression === undefined) {
      return;
    }
    const expression = child.expression;
    const literalString = stringLiteralValue(expression);
    if (literalString !== undefined) {
      addTextNode(context, parentId, literalString, expression);
      return;
    }
    if (ts.isNumericLiteral(expression)) {
      addTextNode(context, parentId, expression.text, expression);
      return;
    }
    const marker = parseBindingMarker(context, expression, "text");
    if (marker === undefined) {
      report(context, expression, "implicit_dynamic_binding", "dynamic JSX text needs ruseact.bindText with explicit dependencies");
      return;
    }
    const textId = addTextNode(context, parentId, "", expression);
    addBinding(context, marker, textId, expression, "text", {});
    return;
  }
  if (ts.isJsxFragment(child)) {
    report(context, child, "unsupported_fragment", "JSX fragments are not supported in the static M4.3 subset");
    return;
  }
  report(context, child, "unsupported_child", "this JSX child form is not supported");
}

function parseElement(
  context: PlanBuilderContext,
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  parentId: string | undefined,
): void {
  const openingElement = ts.isJsxElement(element) ? element.openingElement : element;
  const tag = jsxTagName(openingElement.tagName);
  if (tag === undefined || !isSupportedIntrinsicName(tag)) {
    report(context, openingElement.tagName, "unsupported_component_tag", "only lowercase HTML intrinsic elements are supported");
    return;
  }
  const id = `n${context.nextNode}`;
  context.nextNode += 1;
  const node: NodePlan = {
    id,
    kind: "element",
    ...(parentId === undefined ? {} : { parentId }),
    sourceNode: element,
    name: tag,
    attributes: [],
    properties: [],
  };
  context.nodes.push(node);
  addNodeMetadata(context, node);
  parseAttributes(context, element, id);
  if (ts.isJsxElement(element)) {
    for (const child of element.children) {
      parseChild(context, child, id);
    }
  }
}

function objectProperty(name: string, initializer: ts.Expression): ts.PropertyAssignment {
  return factory.createPropertyAssignment(factory.createIdentifier(name), initializer);
}

function arrayExpression(values: readonly ts.Expression[]): ts.ArrayLiteralExpression {
  return factory.createArrayLiteralExpression([...values], false);
}

function stringExpression(value: string): ts.StringLiteral {
  return factory.createStringLiteral(value);
}

function makeStaticNodeExpression(node: NodePlan): ts.ObjectLiteralExpression {
  const properties: ts.ObjectLiteralElementLike[] = [
    objectProperty("id", stringExpression(node.id)),
    objectProperty("kind", stringExpression(node.kind)),
  ];
  if (node.parentId !== undefined) {
    properties.push(objectProperty("parentId", stringExpression(node.parentId)));
  }
  if (node.kind === "text") {
    properties.push(objectProperty("text", stringExpression(node.text ?? "")));
  } else {
    properties.push(objectProperty("name", stringExpression(node.name ?? "")));
    if (node.attributes.length > 0) {
      properties.push(objectProperty("attributes", factory.createArrayLiteralExpression(node.attributes.map((attribute) => factory.createObjectLiteralExpression([
        objectProperty("name", stringExpression(attribute.name)),
        objectProperty("value", stringExpression(attribute.value)),
      ]), false), false)));
    }
    if (node.properties.length > 0) {
      properties.push(objectProperty("properties", factory.createArrayLiteralExpression(node.properties.map((property) => factory.createObjectLiteralExpression([
        objectProperty("property", stringExpression(property.property)),
        objectProperty("value", typeof property.value === "boolean" ? (property.value ? factory.createTrue() : factory.createFalse()) : stringExpression(property.value)),
      ], false)), false)));
    }
  }
  return factory.createObjectLiteralExpression(properties, true);
}

function makeBindingEvaluator(binding: BindingPlan): ts.ArrowFunction {
  const contextParameter = factory.createParameterDeclaration(
    undefined,
    undefined,
    "context",
    undefined,
    undefined,
    undefined,
  );
  const resultName = factory.createIdentifier("result");
  const resultCall = factory.createCallExpression(binding.evaluator, undefined, [factory.createIdentifier("context")]);
  const resultReference = factory.createIdentifier("result");
  const statements: ts.Statement[] = [
    factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList([
        factory.createVariableDeclaration(resultName, undefined, undefined, resultCall),
      ], ts.NodeFlags.Const),
    ),
    factory.createIfStatement(
      factory.createPrefixUnaryExpression(
        ts.SyntaxKind.ExclamationToken,
        factory.createPropertyAccessExpression(resultReference, "ok"),
      ),
      factory.createBlock([factory.createReturnStatement(resultReference)], true),
    ),
  ];
  if (binding.kind === "text" || binding.kind === "attribute") {
    statements.push(factory.createReturnStatement(factory.createObjectLiteralExpression([
      objectProperty("ok", factory.createTrue()),
      objectProperty("value", factory.createCallExpression(factory.createIdentifier("String"), undefined, [
        factory.createPropertyAccessExpression(resultReference, "value"),
      ])),
    ], true)));
  } else {
    statements.push(factory.createReturnStatement(resultReference));
  }
  return factory.createArrowFunction(
    undefined,
    undefined,
    [contextParameter],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock(statements, true),
  );
}

function makeBindingExpression(binding: BindingPlan): ts.ObjectLiteralExpression {
  const properties: ts.ObjectLiteralElementLike[] = [
    objectProperty("kind", stringExpression(binding.kind)),
    objectProperty("slot", stringExpression(binding.slot)),
    objectProperty("targetId", stringExpression(binding.targetId)),
    objectProperty("dependencies", arrayExpression(binding.dependencies)),
    objectProperty("evaluate", makeBindingEvaluator(binding)),
  ];
  if (binding.kind === "attribute") {
    properties.push(objectProperty("name", stringExpression(binding.name ?? "")));
  }
  if (binding.kind === "property") {
    properties.push(objectProperty("property", stringExpression(binding.property ?? "")));
  }
  return factory.createObjectLiteralExpression(properties, true);
}

function makeListenerExpression(listener: ListenerPlan): ts.ObjectLiteralExpression {
  const properties: ts.ObjectLiteralElementLike[] = [
    objectProperty("id", stringExpression(listener.id)),
    objectProperty("targetId", stringExpression(listener.targetId)),
    objectProperty("type", stringExpression(listener.type)),
    objectProperty("listener", listener.listener),
  ];
  if (listener.capture) {
    properties.push(objectProperty("options", factory.createObjectLiteralExpression([
      objectProperty("capture", factory.createTrue()),
    ], false)));
  }
  return factory.createObjectLiteralExpression(properties, true);
}

function makeViewExpression(
  context: PlanBuilderContext,
  templateId: string,
): ts.ObjectLiteralExpression {
  const plan = factory.createObjectLiteralExpression([
    objectProperty("nodes", factory.createArrayLiteralExpression(context.nodes.map(makeStaticNodeExpression), true)),
    objectProperty("bindings", factory.createArrayLiteralExpression(context.bindings.map(makeBindingExpression), true)),
    objectProperty("listeners", factory.createArrayLiteralExpression(context.listeners.map(makeListenerExpression), true)),
  ], true);
  const instantiate = factory.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    plan,
  );
  return factory.createObjectLiteralExpression([
    objectProperty("protocol", stringExpression("ruseact.template")),
    objectProperty("version", factory.createNumericLiteral(1)),
    objectProperty("templateId", stringExpression(templateId)),
    objectProperty("instantiate", instantiate),
  ], true);
}

function compileDiagnostic(sourceFile: ts.SourceFile, diagnostic: ts.Diagnostic): CompilerDiagnostic {
  const start = diagnostic.start ?? 0;
  const position = sourceFile.getLineAndCharacterOfPosition(Math.min(start, sourceFile.getFullText().length));
  return {
    category: "error",
    code: "tsx_syntax",
    message: flattenMessage(diagnostic.messageText),
    location: {
      fileName: sourceFile.fileName,
      line: position.line + 1,
      column: position.character + 1,
      length: Math.max(1, diagnostic.length ?? 1),
    },
  };
}

function hasJsx(sourceFile: ts.SourceFile): boolean {
  let found = false;
  const visitor = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visitor);
  };
  visitor(sourceFile);
  return found;
}

export function compileTsxModule(source: string, options: CompileOptions = {}): CompileResult {
  const fileName = options.fileName ?? "ruseact.tsx";
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const parseDiagnostics = (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const diagnostics = parseDiagnostics.map((diagnostic) => compileDiagnostic(sourceFile, diagnostic));
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  if (!hasJsx(sourceFile)) {
    return {
      ok: false,
      diagnostics: [{
        category: "error",
        code: "no_jsx",
        message: "the compiler input does not contain JSX",
        location: locationOf(sourceFile, sourceFile),
      }],
    };
  }

  const contextFactory: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit = (node: ts.Node): ts.VisitResult<ts.Node> => {
      if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
        if (ts.isJsxFragment(node)) {
          const planContext: PlanBuilderContext = {
            sourceFile,
            diagnostics,
            nodes: [],
            bindings: [],
            listeners: [],
            nodeMetadata: [],
            slotMetadata: [],
            nextNode: 0,
            nextBinding: 0,
            nextListener: 0,
          };
          report(planContext, node, "unsupported_fragment", "JSX fragments are not supported in the static M4.3 subset");
        }
        return ts.visitEachChild(node, visit, context);
      }
      const planContext: PlanBuilderContext = {
        sourceFile,
        diagnostics,
        nodes: [],
        bindings: [],
        listeners: [],
        nodeMetadata: [],
        slotMetadata: [],
        nextNode: 0,
        nextBinding: 0,
        nextListener: 0,
      };
      parseElement(planContext, node, undefined);
      const templateSource = source.slice(node.getStart(sourceFile), node.getEnd());
      const templateId = `m4.3-${hashTemplate(`${fileName}\0${templateSource}`)}`;
      return makeViewExpression(planContext, templateId);
    };
    return (node) => ts.visitNode(node, visit) as ts.SourceFile;
  };

  const transformed = ts.transform(sourceFile, [contextFactory]);
  const printed = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]);
  transformed.dispose();
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const emitted = ts.transpileModule(printed, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      sourceMap: false,
    },
  });
  const emittedDiagnostics = (emitted.diagnostics ?? []).map((diagnostic) => compileDiagnostic(sourceFile, diagnostic));
  if (emittedDiagnostics.length > 0) {
    return { ok: false, diagnostics: emittedDiagnostics };
  }

  const metadataContext: PlanBuilderContext = {
    sourceFile,
    diagnostics: [],
    nodes: [],
    bindings: [],
    listeners: [],
    nodeMetadata: [],
    slotMetadata: [],
    nextNode: 0,
    nextBinding: 0,
    nextListener: 0,
  };
  const firstJsx = (() => {
    let result: ts.JsxElement | ts.JsxSelfClosingElement | undefined;
    const visitor = (node: ts.Node): void => {
      if (result !== undefined) return;
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        result = node;
        return;
      }
      ts.forEachChild(node, visitor);
    };
    visitor(sourceFile);
    return result;
  })();
  if (firstJsx !== undefined) {
    parseElement(metadataContext, firstJsx, undefined);
  }
  return {
    ok: true,
    code: emitted.outputText,
    metadata: {
      templateId: `m4.3-${hashTemplate(`${fileName}\0${firstJsx === undefined ? "" : source.slice(firstJsx.getStart(sourceFile), firstJsx.getEnd())}`)}`,
      nodes: metadataContext.nodeMetadata,
      slots: metadataContext.slotMetadata,
    },
  };
}
