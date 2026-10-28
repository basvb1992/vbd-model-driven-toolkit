import * as VBD from "vbd-model-driven-toolkit";
import type { ToolkitConfiguration, Diagnostic } from "vbd-model-driven-toolkit";

const result = VBD.Config.validate({});
if (result.valid) {
  const configuration: ToolkitConfiguration = result.configuration;
  VBD.Config.register(configuration.id, configuration);
  VBD.Config.get(configuration.id);
}
const diagnostic: Promise<{ correlationId: string; reported: true }> =
  VBD.Diagnostics.report(new Error("example"), {
    operation: "example",
    sink: (value: Diagnostic): void => { void value; }
  });
void diagnostic;
