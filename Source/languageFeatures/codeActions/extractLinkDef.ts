/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";
import * as lsp from "vscode-languageserver-protocol";

import {
	ExternalHref,
	HrefKind,
	InternalHref,
	LinkDefinitionSet,
	MdAutoLink,
	MdInlineLink,
	MdLink,
	MdLinkDefinition,
	MdLinkKind,
} from "../../types/documentLink";
import { comparePosition, translatePosition } from "../../types/position";
import { rangeIntersects } from "../../types/range";
import { getDocUri, getLine, ITextDocument } from "../../types/textDocument";
import { WorkspaceEditBuilder } from "../../util/editBuilder";
import { isSameResource } from "../../util/path";
import { MdDocumentLinksInfo, MdLinkProvider } from "../documentLinks";
import { getExistingDefinitionBlock } from "../organizeLinkDefs";
import { codeActionKindContains } from "./util";

export class MdExtractLinkDefinitionCodeActionProvider {
	public static readonly genericTitle = l10n.t("Extract to link definition");

	static #kind = lsp.CodeActionKind.RefactorExtract + ".linkDefinition";

	public static readonly notOnLinkAction: lsp.CodeAction = {
		title: this.genericTitle,
		kind: this.#kind,
		disabled: {
			reason: l10n.t("Not on link"),
		},
	};

	public static readonly alreadyRefLinkAction: lsp.CodeAction = {
		title: this.genericTitle,
		kind: this.#kind,
		disabled: {
			reason: l10n.t("Link is already a reference"),
		},
	};

	readonly #linkProvider: MdLinkProvider;

	constructor(linkProvider: MdLinkProvider) {
		this.#linkProvider = linkProvider;
	}

	async getActions(
		doc: ITextDocument,
		range: lsp.Range,
		context: lsp.CodeActionContext,
		token: lsp.CancellationToken,
	): Promise<lsp.CodeAction[]> {
		if (!this.#isEnabled(context)) {
			return [];
		}

		const linkInfo = await this.#linkProvider.getLinks(doc);

		if (token.isCancellationRequested) {
			return [];
		}

		const linksInRange = linkInfo.links.filter(
			(link) =>
				link.kind !== MdLinkKind.Definition &&
				rangeIntersects(range, link.source.range),
		) as MdInlineLink[];

		if (!linksInRange.length) {
			return [MdExtractLinkDefinitionCodeActionProvider.notOnLinkAction];
		}

		// Sort by range start to get most specific link
		linksInRange.sort((a, b) =>
			comparePosition(b.source.range.start, a.source.range.start),
		);

		// Even though multiple links may be in the selection, we only generate an action for the first link we find.
		// Creating actions for every link is overwhelming when users select all in a file
		const targetLink = linksInRange.find(
			(link) =>
				link.href.kind === HrefKind.External ||
				link.href.kind === HrefKind.Internal,
		);

		if (!targetLink) {
			return [
				MdExtractLinkDefinitionCodeActionProvider.alreadyRefLinkAction,
			];
		}

		return [
			this.#getExtractLinkAction(
				doc,
				linkInfo,
				targetLink as MdInlineLink<InternalHref | ExternalHref>,
			),
		];
	}

	#isEnabled(context: lsp.CodeActionContext): boolean {
		if (typeof context.only === "undefined") {
			return true;
		}

		return context.only.some((kind) =>
			codeActionKindContains(lsp.CodeActionKind.Refactor, kind),
		);
	}

	#getExtractLinkAction(
		doc: ITextDocument,
		linkInfo: MdDocumentLinksInfo,
		targetLink: MdInlineLink<InternalHref | ExternalHref>,
	): lsp.CodeAction {
		const builder = new WorkspaceEditBuilder();

		const resource = getDocUri(doc);

		const placeholder = this.#getPlaceholder(linkInfo.definitions);

		// Rewrite all inline occurrences of the link
		for (const link of linkInfo.links) {
			if (
				link.kind === MdLinkKind.Link ||
				link.kind === MdLinkKind.AutoLink
			) {
				if (this.#matchesHref(targetLink.href, link)) {
					const targetRange =
						link.kind === MdLinkKind.AutoLink
							? link.source.range
							: link.source.targetRange;
					builder.replace(resource, targetRange, `[${placeholder}]`);
				}
			}
		}

		const definitionText = getLinkTargetText(doc, targetLink).trim();

		const definitions = linkInfo.links.filter(
			(link) => link.kind === MdLinkKind.Definition,
		) as MdLinkDefinition[];

		const defEdit = createAddDefinitionEdit(doc, definitions, [
			{ definitionText, placeholder },
		]);
		builder.insert(resource, defEdit.range.start, defEdit.newText);

		const renamePosition = translatePosition(
			targetLink.source.targetRange.start,
			{ characterDelta: 1 },
		);

		return {
			title: MdExtractLinkDefinitionCodeActionProvider.genericTitle,
			kind: MdExtractLinkDefinitionCodeActionProvider.#kind,
			edit: builder.getEdit(),
			command: {
				command: "vscodeMarkdownLanguageservice.rename",
				title: "Rename",
				arguments: [getDocUri(doc), renamePosition],
			},
		};
	}

	#getPlaceholder(definitions: LinkDefinitionSet): string {
		const base = "def";

		for (let i = 1; ; ++i) {
			const name = i === 1 ? base : `${base}${i}`;

			if (typeof definitions.lookup(name) === "undefined") {
				return name;
			}
		}
	}

	#matchesHref(href: InternalHref | ExternalHref, link: MdLink): boolean {
		if (
			link.href.kind === HrefKind.External &&
			href.kind === HrefKind.External
		) {
			return isSameResource(link.href.uri, href.uri);
		}

		if (
			link.href.kind === HrefKind.Internal &&
			href.kind === HrefKind.Internal
		) {
			return (
				isSameResource(link.href.path, href.path) &&
				link.href.fragment === href.fragment
			);
		}

		return false;
	}
}

export function createAddDefinitionEdit(
	doc: ITextDocument,
	existingDefinitions: readonly MdLinkDefinition[],
	newDefs: ReadonlyArray<{ definitionText: string; placeholder: string }>,
): lsp.TextEdit {
	const defBlock = getExistingDefinitionBlock(doc, existingDefinitions);

	const newDefText = newDefs
		.map(
			({ definitionText, placeholder }) =>
				`[${placeholder}]: ${definitionText}`,
		)
		.join("\n");

	if (!defBlock) {
		return lsp.TextEdit.insert(
			{ line: doc.lineCount, character: 0 },
			"\n\n" + newDefText,
		);
	} else {
		const line = getLine(doc, defBlock.endLine);

		return lsp.TextEdit.insert(
			{ line: defBlock.endLine, character: line.length },
			"\n" + newDefText,
		);
	}
}

function getLinkTargetText(
	doc: ITextDocument,
	link: MdInlineLink | MdAutoLink,
) {
	const afterHrefRange =
		link.kind === MdLinkKind.AutoLink
			? link.source.targetRange
			: lsp.Range.create(
					translatePosition(link.source.targetRange.start, {
						characterDelta: 1,
					}),
					translatePosition(link.source.targetRange.end, {
						characterDelta: -1,
					}),
				);

	return doc.getText(afterHrefRange);
}
