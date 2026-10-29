import { Config } from "./configuration.js";
import { Diagnostics } from "./diagnostics.js";
import { VbdError } from "./errors.js";
import { Environment } from "./environment.js";
import { Links } from "./links.js";
import { Launch } from "./launch.js";
import { Windows } from "./windows.js";
import { Utils } from "./utils.js";
import { Context } from "./context.js";
import { Navigation, Dialogs } from "./navigation.js";
import { UI } from "./ui.js";
import { Fields, Forms } from "./forms.js";
import { Controls, Layout } from "./controls.js";
import { Lookups, Choices } from "./lookups.js";
import { Validation } from "./form-validation.js";
import { Events } from "./events.js";
import { Commands, Grids } from "./commands.js";
import { Data } from "./data.js";
import { Query } from "./query.js";
import { Actions } from "./actions.js";
import { SidePanes } from "./side-panes.js";
import { Security } from "./security.js";
import { Bindings } from "./bindings.js";
import { Cache } from "./cache.js";
import { Execution } from "./execution.js";
import { Metadata } from "./metadata.js";
import { Batch } from "./batch.js";
import { I18n } from "./i18n.js";

if (Object.prototype.hasOwnProperty.call(globalThis, "VBD")) {
  throw new VbdError("DUPLICATE_INITIALIZATION", { operation: "initialize" });
}
Object.defineProperty(globalThis, "VBD", {
  value: Object.freeze({
    Config, Diagnostics, Environment, Links, Launch, Windows,
    Utils, Context, Navigation, Dialogs, UI, Fields, Forms, Controls, Layout,
    Lookups, Choices, Validation, Events, Commands, Grids, Data, Query, Actions,
    SidePanes, Security, Bindings, Cache, Execution, Metadata, Batch, I18n
  }),
  enumerable: true,
  writable: false,
  configurable: false
});
