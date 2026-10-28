# Official platform references

Design references reviewed on 2026-10-28. Platform documentation can change;
recheck the exact API and client support before implementation.

| Topic | Reference | Design implication |
| --- | --- | --- |
| Navigation/page inputs | [navigateTo](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-navigation/navigateto) | Supported page types, size/position, and return contracts differ. |
| Native form windows | [openForm](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-navigation/openform) | openInNewWindow/chrome options differ from openUrl; main forms do not provide the Quick Create save callback. |
| Host URL navigation | [openUrl](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-navigation/openurl) | Documented host options are height/width; do not assume PCF option parity. |
| Deep links | [Open apps, forms, views, and reports with a URL](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/open-forms-views-dialogs-reports-url) | Use supported addressing; links do not bypass access checks. |
| Modern commands | [Use command designer](https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/use-command-designer) | JavaScript actions and parameter wiring are supported; one command action is not an arbitrary list of calls. |
| Ribbon context | [Pass data to ribbon actions](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/pass-data-page-parameter-ribbon-actions) | PrimaryControl, SelectedControl, IDs, and references are distinct inputs. |
| Environment configuration | [Environment variables overview](https://learn.microsoft.com/en-us/power-apps/maker/data-platform/environmentvariables) | Current/default separation, supported types, and ALM behavior. |
| Effective-value retrieval | [RetrieveEnvironmentVariableValue](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/retrieveenvironmentvariablevalue?view=dataverse-latest) | Supported value-resolution contract; validate type and browser-safe use. |
| Lookup pre-search | [addPreSearch](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/controls/addpresearch) | Apply supported lookup filtering at the correct lifecycle point. |
| App side panes | [Create app side panes](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/create-app-side-panes) | A persistent app pane is not a right-positioned modal dialog. |
| Dataverse client API | [Xrm.WebApi](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-webapi) | Supported online/offline capabilities differ by method. |

Browser popup activation, opener isolation, named-target reuse, and outcome
observability must additionally be tested in supported real browsers. A
successful navigation API invocation is not evidence that a remote page loaded.
