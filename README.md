# oMLX Copilot Chat

Use models served by oMLX from the Visual Studio Code Copilot Chat model picker.

Repository: https://github.com/mikedoise/oMLX-Copilot-Chat

This extension registers `oMLX` as a VS Code Language Model Chat Provider and
talks to the oMLX OpenAI-compatible API:

- `GET /v1/models`
- `POST /v1/chat/completions`

The default endpoint is `http://127.0.0.1:8000/v1`.

## Requirements

- VS Code 1.104 or newer
- GitHub Copilot Chat
- A running oMLX server
- An oMLX API token generated in the oMLX admin panel

## Setup

1. Start oMLX.
2. Generate an API token in the oMLX admin panel.
3. Run `oMLX: Set API Token` from the Command Palette.
4. Wait for the token validation message. If validation fails, paste the exact token from oMLX again.
5. Run `oMLX: Test Connection` if you want to retest later.
6. Open Copilot Chat, manage language models, and enable the oMLX models you want to use.

The token is stored in VS Code Secret Storage, not in `settings.json`.
`oMLX: Set API Token` only changes the token VS Code sends to oMLX; it does not
create or rotate a token in oMLX. The value must exactly match a token generated
in the oMLX admin panel.

## Copilot Agent Context

Copilot Agent mode has a large built-in prompt. If an oMLX model is advertised
with a 32k context window, Copilot may compact the conversation on nearly every
turn even for short prompts.

For normal Agent mode use, configure oMLX to allow a larger context window and
set the advertised input-token override in VS Code:

```json
"omlx.maxInputTokensOverride": 65536
```

Use `131072` if the selected oMLX model and runtime are configured for a 128k
context. Keep the override at `0` when you want the extension to use the context
reported by `/v1/models`.

The override only changes what the extension advertises to Copilot. The oMLX
server must also be configured to accept that context size, or oMLX will reject
long requests with a prompt-too-long error.

## Settings

- `omlx.baseUrl`: oMLX OpenAI-compatible base URL.
- `omlx.maxInputTokensOverride`: optional input-token override. Leave as `0` to auto-detect from model metadata. For Copilot Agent mode, use `65536` or higher if oMLX is configured for that context size.
- `omlx.maxOutputTokensOverride`: optional output-token override. Leave as `0` to use model metadata when available.
- `omlx.requestTimeoutMs`: request timeout for model discovery and chat requests.
- `omlx.enableImageInput`: advertise OpenAI-compatible image input support.
- `omlx.enableToolCalling`: advertise and forward OpenAI-compatible tool calls. Defaults to `true` for Agent mode compatibility.
- `omlx.maxToolCount`: maximum number of tools advertised for Agent mode requests. Defaults to `16`.

Image input defaults to off. Tool calling defaults to on because VS Code Agent
mode filters for tool-capable models. Disable tool calling if your selected
oMLX model/server rejects OpenAI-compatible tool schemas.

If oMLX rejects a request with a concrete runtime context-window error, the
extension remembers that limit for the model and refreshes the advertised model
metadata for future requests.

## Development

```sh
npm install
npm run compile
```

Press `F5` in VS Code to launch **Run Extension (Isolated)**. This uses
`--disable-extensions` so no other user-installed extensions activate; the
current extension is loaded via `--extensionDevelopmentPath`. It also gives
the debug host an independent, persistent user-data directory and empty
extensions directory under `.vscode/`, both ignored by Git. This prevents
normal VS Code profiles and installed extensions from affecting debug sessions
while retaining the debug host's settings between restarts.

**Note:** GitHub Copilot Chat is also disabled in this isolated host.
Use it to debug extension activation, sidebar, Home and Settings. End-to-end
Copilot Chat/model-provider and PDF attachment testing requires a separate
integration session with GitHub Copilot Chat enabled.


## Sidebar navigation

The oMLX activity bar entry contains two TreeView shortcuts:

- **Home** opens the existing admin dashboard in a dedicated **oMLX Home**
  Webview Panel without a browser address bar. Repeated clicks reveal the same
  editor tab. The configured `omlx.baseUrl` supplies the admin server address.
  - If the saved VS Code API token is the oMLX **main** admin key, Home uses the
    official `POST /admin/api/login` to create a short-lived admin session and
    forwards it through a random-port, loopback-only bridge. The key never enters
    the iframe, HTML, URL, browser cookie, or console. Each panel's bridge is
    disposed when its tab closes. The browser receives only a partitioned,
    HttpOnly capability cookie.
  - If the saved token is an **inference sub-key**, or no valid admin session can
    be created, use **Set admin API key** at the top of Home. This opens VS Code's
    native secure input box (normal macOS Cmd+V works). The admin key is stored
    separately in VS Code Secret Storage and is not used for inference requests.
    After saving, Home retries automatic session authentication.
  - This is a local desktop convenience; third-party cookie restrictions or
    server frame-embedding policies may still prevent an iframe from loading
    correctly in some environments. Do not disable browser security to work
    around this. Use the standalone admin website in those cases.
  - The standard admin UI remains inside an iframe. On macOS, its other text
    inputs may still suffer from VS Code's nested-iframe Cmd+V bug
    (microsoft/vscode#129178). The native **Set admin API key** path avoids
    that limitation specifically for signing in.
- **Settings** opens a VS Code-themed settings panel that is generated from the
  extension's declared `omlx.*` configuration schema. It supports User and
  Workspace scope, save, reset, and API-token actions. API tokens stay in
  VS Code Secret Storage and are never placed in the webview or settings.json.

## PDF attachments

When VS Code sends `LanguageModelDataPart` data with
`mimeType: application/pdf`, the extension forwards it to oMLX as an
OpenAI Chat Completions `file` content part with `file_data` containing
a base64 data URI. Unlike images, this does not require enabling
`omlx.enableImageInput`. oMLX must have its document/MarkItDown
preprocessing enabled to extract text.

**VS Code limitation:** Some versions of GitHub Copilot Chat drop PDF document
parts before calling third-party Language Model Chat Providers
([microsoft/vscode#336694](https://github.com/microsoft/vscode/issues/336694)).
This extension cannot recover files it never receives. The oMLX output channel
logs how many PDF data parts reach the provider, without logging their bytes.
If the Copilot request contains an empty `<attachments>` wrapper, the provider
returns an explicit error rather than claiming to have read the attachment.
The extension now also logs **PDF data parts received from VS Code** and
**PDF file parts forwarded to oMLX** separately and fails when a received PDF
could not be forwarded. The proposed `fileInputMimeTypes: ['application/pdf']`
capability is advertised for hosts that support it; current stable builds may
ignore the hint. **This cannot repair PDF data already dropped inside Copilot.**
The upstream fixes (microsoft/vscode#336694 and #328403) must land before
drag-and-drop PDF is guaranteed in third-party provider mode. Until then, use
an oMLX-native file input or a user-selected workspace document. Tool-result
image/PDF content, when provided as binary parts, is preserved rather than
silently converted into empty strings.

## Tests

```sh
npm test
```

This runs the TypeScript compiler and Node.js built-in tests for PDF and
image attachment conversion, extension activation, Home webview lifecycle,
secure admin session bridging, and multimodal tool-result conversion.


### Missing sidebar data provider

If the oMLX sidebar displays `There is no data provider registered that can provide view data`,
rebuild and restart the Extension Development Host. The extension registers the
`omlx.navigation` TreeDataProvider before attempting chat-model registration,
so isolated debugging still exposes Home and Settings even when chat integration
is unavailable. Model-provider registration errors are reported in the
**oMLX Copilot Chat** output channel.

Run `npm test` to verify the activation regression test as well as PDF
attachment conversion.
