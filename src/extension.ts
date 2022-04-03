import * as fs from 'fs';
import * as vscode from 'vscode';
import * as process from 'child_process';

/**
 * this method is called when your extension is activated
 * your extension is activated the very first time the command is executed
 */
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('cCallHierarchy.build', buildDatabase));

	vscode.languages.registerCallHierarchyProvider(
		{
			scheme: 'file',
			language: 'c'
		},
		new CCallHierarchyProvider());
}

// this method is called when your extension is deactivated
export function deactivate() { }

class FuncInfo {
	name: string;
	fileName: string;
	description: string;
	position: number;

	constructor(name?: string, fileName?: string, position?: number) {
		this.name = name ?? '';
		this.fileName = fileName ?? '';
		this.position = position ?? -1;

		this.description = '';
	}

	public static convertToFuncInfo(line: string): FuncInfo {
		let lineSplit = line.split(' ');
		return new FuncInfo(lineSplit[1], lineSplit[0], Number(lineSplit[2]));
	}
}

export class CallHierarchyItem extends vscode.CallHierarchyItem {
	constructor(
		public kind: vscode.SymbolKind,
		public name: string,
		public detail: string,
		public uri: vscode.Uri,
		public range: vscode.Range,
		public selectionRange: vscode.Range) {
		super(kind, name, detail, uri, range, selectionRange);
	}
}

export class CCallHierarchyProvider implements vscode.CallHierarchyProvider {
	private readonly cwd: string;

	constructor() {
		this.cwd = getWorkspaceRootPath();
	}

	async prepareCallHierarchy(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken): Promise<CallHierarchyItem | CallHierarchyItem[] | null | undefined> {
		if (!token.isCancellationRequested) {
			if (!fs.existsSync(`${this.cwd}/cscope.out`)) {
				vscode.window.showInformationMessage(`Database doesn't exist, rebuilding...`);
				await buildDatabase();
			}

			let wordRange = document.getWordRangeAtPosition(position);

			if (wordRange !== undefined) {
				let funcName: string = document.getText(wordRange);
				let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${funcName}`);

				if (definition.length > 0) {
					let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

					let item = new CallHierarchyItem(
						vscode.SymbolKind.Function,
						funcName,
						`@ ${funcInfo.position.toString()}`,
						vscode.Uri.file(`${this.cwd}/${funcInfo.fileName}`),
						new vscode.Range(new vscode.Position(funcInfo.position - 1, 0), new vscode.Position(funcInfo.position - 1, 0)),
						new vscode.Range(new vscode.Position(funcInfo.position - 1, 0), new vscode.Position(funcInfo.position - 1, 0)));

					return item;
				}
			}
		}
	}

	async provideCallHierarchyIncomingCalls(
		item: CallHierarchyItem,
		token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[] | null | undefined> {
		if (!token.isCancellationRequested) {
			let incomingCalls: Array<vscode.CallHierarchyIncomingCall> = new Array();

			let callers = await findCallers(item.name);

			for (let callerItem of callers) {
				let ranges: Array<vscode.Range> = new Array();

				let callerItemPosition = new vscode.Position(callerItem.position - 1, 0);
				let callerItemRange = new vscode.Range(callerItemPosition, callerItemPosition);

				let fromCaller = new CallHierarchyItem(
					vscode.SymbolKind.Function,
					callerItem.name,
					`@ ${callerItem.position.toString()}`,
					vscode.Uri.file(`${this.cwd}/${callerItem.fileName}`),
					callerItemRange,
					callerItemRange);

				ranges.push(callerItemRange);

				incomingCalls.push(new vscode.CallHierarchyIncomingCall(fromCaller, ranges));
			}

			return incomingCalls;
		}
	}

	async provideCallHierarchyOutgoingCalls(
		item: CallHierarchyItem,
		token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[] | null | undefined> {
		if (!token.isCancellationRequested) {
			let outgoingCalls: Array<vscode.CallHierarchyOutgoingCall> = new Array();

			let callees = await findCallees(item.name);

			for (let calleeItem of callees) {
				let ranges: Array<vscode.Range> = new Array();

				let calleeItemPosition = new vscode.Position(calleeItem.position - 1, 0);
				let calleeItemRange = new vscode.Range(calleeItemPosition, calleeItemPosition);

				let toCallee = new CallHierarchyItem(
					vscode.SymbolKind.Function,
					calleeItem.name,
					`@ ${calleeItem.position.toString()}`,
					vscode.Uri.file(`${this.cwd}/${calleeItem.fileName}`),
					calleeItemRange,
					calleeItemRange);

				ranges.push(calleeItemRange);

				outgoingCalls.push(new vscode.CallHierarchyOutgoingCall(toCallee, ranges));
			}

			return outgoingCalls;
		}
	}
}

export async function findCallers(funcName: string): Promise<Array<FuncInfo>> {
	let callers: Array<FuncInfo> = new Array();

	let data: string = await doCLI(`cscope.exe -d -f cscope.out -L3 ${funcName}`) as string;

	let lines = data.split('\n');

	for (let line of lines) {
		if (line.length > 0) {
			let funcInfo = FuncInfo.convertToFuncInfo(line);
			callers.push(funcInfo);
		}
	}

	return callers;
}

export async function findCallees(funcName: string): Promise<Array<FuncInfo>> {
	let callees: Array<FuncInfo> = new Array();

	let data: string = await doCLI(`cscope.exe -d -f cscope.out -L2 ${funcName}`) as string;

	let lines = data.split('\n');

	for (let line of lines) {
		if (line.length > 0) {
			let funcInfo = FuncInfo.convertToFuncInfo(line);
			callees.push(funcInfo);
		}
	}

	return callees;
}

export async function buildDatabase() {
	vscode.window.showInformationMessage('Building Database...');

	await doCLI(`cscope.exe -Rcb`);

	vscode.window.showInformationMessage('Finished building database');
}

export async function doCLI(command: string): Promise<string> {
	let dir = getWorkspaceRootPath();

	return new Promise((resolve, _) => {
		process.exec(
			command,
			{ cwd: dir },
			(error: process.ExecException | null, stdout: string, stderr: string) => {
				if (error) {
					vscode.window.showErrorMessage(`exec error: ${error}`);
				} else {
					vscode.window.showErrorMessage(stderr);
					resolve(stdout);
				}
			});
	});
}

export function getWorkspaceRootPath(): string {
	return vscode.workspace.workspaceFolders !== undefined ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
}