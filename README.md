# VS Code Markdown Language Service

> ❗ Note this project is actively being developed and not yet ready for production use!

The language service that powers VS Code's Markdown support, extracted so that it can be reused by other editors and tools.


## Features

This library targets [CommonMark](https://commonmark.org). Support for other Markdown dialects and extensions is not within the scope of this project.

Currently supported language features:

- Document links (clickable spans in the editor)

	Supported links include:

	- Links to headers within the current file: `[text](#header)`
	- Absolute and relative links to files: `[text](path/to/file.md)`
	- Reference links: `[text][link-name]`

- Document symbols

	Finds all headers within a markdown file

- Workspace symbols

	Find all headers across all markdown files in the workspace.

- Folding ranges

	Folding ranges are computed for:

	- Header sections
	- Region sections
	- Lists
	- Block elements

- Smart select (expand selection)


## Usage

To get started using this library, first install it into your workspace:

```bash
npm install vscode-markdown-languageservice
```

To use the language service, first you need to create an instance of it using `createLanguageService`. We use dependency injection to allow the language service to be used in as many contexts as possible.

```ts
import * as md from 'vscode-markdown-languageservice';

// Implement these
const parser: md.IMdParser = ...;
const workspace: md.IWorkspace = ...;
const logger: md.ILogger = ...;

const languageService = md.createLanguageService({ workspace, parser, logger });
```

After creating the service, you can ask it for the language features it supports:

```ts
// We're using the vscode-language types in this demo
// If you want to use them, make sure to run:
//
//     npm install vscode-languageserver vscode-languageserver-textdocument
//
// However you can also bring your own types if you want to instead.

import { CancellationTokenSource } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

const cts = new CancellationTokenSource();
const myDocument = TextDocument.create('/path/to/file.md', 'markdown', 1, '# Header 1');

const symbols = await languageService.provideDocumentSymbols(myDocument, cts.token);
```

See [example.cjs](./example.cjs) for complete, minimal example of using the language service. You can run in using `node example.cjs`.


## Additional Links

- [VS Code's Markdown language server](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features/server/)


## Contributing

If you're interested in contributing

1. Clone this repo
1. Install dependencies using `npm install`
1. Start compilation using `npm run watch`

You can run the unit tests using `npm test` or by opening the project in VS Code and pressing `F5` to debug.
