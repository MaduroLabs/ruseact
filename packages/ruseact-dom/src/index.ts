/**
 * Public M4.2 renderer façade. Host, binding, and root implementation
 * contexts remain internal and are deliberately not exported here.
 */
export {
  createRoot,
  type AttributeBindingPlan,
  type BindingEvaluationContext,
  type BindingPlan,
  type FlushReport,
  type ListenerPlan,
  type PropertyBindingPlan,
  type RendererError,
  type RendererErrorCode,
  type RendererListenerOptions,
  type RendererContainer,
  type RendererResult,
  type RendererRoot,
  type RendererRootState,
  type StaticAttributePlan,
  type StaticElementPlan,
  type StaticNodePlan,
  type StaticPropertyPlan,
  type StaticTextPlan,
  type SupportedProperty,
  type TextBindingPlan,
  type ViewDescription,
  type ViewEnvironment,
  type ViewInstancePlan,
} from "./renderer.js";
