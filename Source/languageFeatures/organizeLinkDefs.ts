/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lsp from "vscode-languageserver-protocol";

import { HrefKind, MdLinkDefinition, MdLinkKind } from "../types/documentLink";
import { getLine, ITextDocument } from "../types/textDocument";
import { maxLspUInt } from "../util/number";
import { isEmptyOrWhitespace } from "../util/string";
import { MdLinkProvider } from "./documentLinks";

export class MdOrganizeLinkDefinitionProvider {
	readonly #linkProvider: MdLinkProvider;

	constructor(linkProvider: MdLinkProvider) {
		this.#linkProvider = linkProvider;
	}

	async getOrganizeLinkDefinitionEdits(
		doc: ITextDocument,
		options: { readonly removeUnused?: boolean },
		token: lsp.CancellationToken,
	): Promise<lsp.TextEdit[]> {
		const links = await this.#linkProvider.getLinks(doc);

		if (token.isCancellationRequested) {
			return [];
		}

		const definitions = links.links.filter(
			(link) => link.kind === MdLinkKind.Definition,
		) as MdLinkDefinition[];

		if (!definitions.length) {
			return [];
		}

		const existingDefBlockRange = getExistingDefinitionBlock(
			doc,
			definitions,
		);

		const edits: lsp.TextEdit[] = [];

		// First replace all inline definitions that are not the definition block
		for (const group of this.#getDefinitionBlockGroups(doc, definitions)) {
			if (
				!existingDefBlockRange ||
				group.startLine < existingDefBlockRange.startLine
			) {
				// Don't replace trailing newline of last definition in group
				edits.push({
					newText: "",
					range: lsp.Range.create(
						group.startLine,
						0,
						group.endLine,
						getLine(doc, group.endLine).length,
					),
				});
			}
		}

		// Then replace the actual block
		const sortedDefs = [...definitions];

		sortedDefs.sort((a, b) => a.ref.text.localeCompare(b.ref.text));

		const newDefs = sortedDefs.filter((def) => {
			if (!options.removeUnused) {
				return true;
			}

			return links.links.some((link) => {
				return (
					link.kind === MdLinkKind.Link &&
					link.href.kind === HrefKind.Reference &&
					link.href.ref === def.ref.text
				);
			});
		});

		const defBlock = newDefs
			.map((def) => `[${def.ref.text}]: ${def.source.hrefText}`)
			.join("\n");

		if (existingDefBlockRange) {
			// We still may need to insert a newline
			const hasLeadingWhiteSpace =
				existingDefBlockRange.startLine <= 0 ||
				isEmptyOrWhitespace(
					getLine(doc, existingDefBlockRange.startLine - 1),
				);

			// See if we already have the expected definitions in order
			if (
				!edits.length &&
				newDefs.length === definitions.length &&
				definitions.every((def, i) => def.ref === newDefs[i].ref)
			) {
				return [];
			}

			edits.push({
				newText: (hasLeadingWhiteSpace ? "" : "\n") + defBlock,
				range: lsp.Range.create(
					existingDefBlockRange.startLine,
					0,
					existingDefBlockRange.endLine,
					getLine(doc, existingDefBlockRange.endLine).length,
				),
			});
		} else {
			const line = this.#getLastNonWhitespaceLine(doc, definitions);

			edits.push({
				newText:
					(line === doc.lineCount - 1 ? "\n\n" : "\n") + defBlock,
				range: lsp.Range.create(line + 1, 0, doc.lineCount, 0),
			});
		}

		return edits;
	}

	*#getDefinitionBlockGroups(
		doc: ITextDocument,
		definitions: readonly MdLinkDefinition[],
	): Iterable<{ readonly startLine: number; readonly endLine: number }> {
		if (!definitions.length) {
			return;
		}

		let i = 0;

		const startDef = definitions[i];

		let endDef = startDef;

		for (; i < definitions.length - 1; ++i) {
			const nextDef = definitions[i + 1];

			if (
				nextDef.source.range.start.line ===
				endDef.source.range.start.line + 1
			) {
				endDef = nextDef;
			} else {
				break;
			}
		}

		yield {
			startLine: startDef.source.range.start.line,
			endLine: endDef.source.range.start.line,
		};

		yield* this.#getDefinitionBlockGroups(doc, definitions.slice(i + 1));
	}

	#getLastNonWhitespaceLine(
		doc: ITextDocument,
		orderedDefinitions: readonly MdLinkDefinition[],
	): number {
		const lastDef = orderedDefinitions[orderedDefinitions.length - 1];

		const textAfter = doc.getText(
			lsp.Range.create(
				lastDef.source.range.end.line + 1,
				0,
				maxLspUInt,
				0,
			),
		);

		const lines = textAfter.split(/\r\n|\n/g);

		for (let i = lines.length - 1; i >= 0; --i) {
			if (!isEmptyOrWhitespace(lines[i])) {
				return lastDef.source.range.start.line + 1 + i;
			}
		}

		return lastDef.source.range.start.line;
	}
}

export function getExistingDefinitionBlock(
	doc: ITextDocument,
	orderedDefinitions: readonly MdLinkDefinition[],
): { startLine: number; endLine: number } | undefined {
	if (!orderedDefinitions.length) {
		return undefined;
	}

	const lastDef = orderedDefinitions[orderedDefinitions.length - 1];

	const textAfter = doc.getText(
		lsp.Range.create(lastDef.source.range.end.line + 1, 0, maxLspUInt, 0),
	);

	if (isEmptyOrWhitespace(textAfter)) {
		let prevDef = lastDef;

		for (let i = orderedDefinitions.length - 1; i >= 0; --i) {
			const def = orderedDefinitions[i];

			if (
				def.source.range.start.line <
				prevDef.source.range.start.line - 1
			) {
				break;
			}

			prevDef = def;
		}

		return {
			startLine: prevDef.source.range.start.line,
			endLine: lastDef.source.range.start.line,
		};
	}

	return undefined;
}
