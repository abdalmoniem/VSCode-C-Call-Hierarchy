import * as fs from 'fs';
import * as vscode from 'vscode';
import * as process from 'child_process';

enum ClickJumpLocation {
	symbolDefinition = 'Symbol Definition',
	symboldCall = 'Symbol Call'
}

enum LogLevel {
	info,
	warn,
	error
}

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
		let lineSplit = line.split(/\s+/);
		return new FuncInfo(lineSplit[1], lineSplit[0], Number(lineSplit[2]));
	}

	public getFileName(): string {
		let folders = this.fileName.split(/[\\/]/);

		return folders.slice(-1)[0];
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
				showMessage(`Database doesn't exist, rebuilding...`);
				await buildDatabase();
			}

			let wordRange = document.getWordRangeAtPosition(position);

			if (wordRange !== undefined) {
				let funcName: string = document.getText(wordRange);
				let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${funcName}`);

				if (definition.length > 0) {
					let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

					let config = vscode.workspace.getConfiguration('ccallhierarchy');
					let canShowFileNames = config.get('showFileNamesInSearchResults');
					let clickJumpLocation = config.get('clickJumpLocation');

					let functionRange = wordRange;

					let fileLocation = vscode.Uri.file(`${document.fileName}`);

					let fileName = document.fileName.split(/[\\/]/).slice(-1)[0];

					let description = `${canShowFileNames ? fileName : ''} @ ${(position.line + 1).toString()}`;

					if (clickJumpLocation === ClickJumpLocation.symbolDefinition) {
						let functionPosition = new vscode.Position(funcInfo.position - 1, 0);
						functionRange = new vscode.Range(functionPosition, functionPosition);

						fileLocation = vscode.Uri.file(`${this.cwd}/${funcInfo.fileName}`);

						description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.position.toString()}`;
					}

					let item = new CallHierarchyItem(
						vscode.SymbolKind.Function,
						funcName,
						description,
						fileLocation,
						functionRange,
						functionRange);

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

				let config = vscode.workspace.getConfiguration('ccallhierarchy');
				let canShowFileNames = config.get('showFileNamesInSearchResults');
				let clickJumpLocation = config.get('clickJumpLocation');

				let callerItemPosition = new vscode.Position(callerItem.position - 1, 0);

				let fileLocation = vscode.Uri.file(`${this.cwd}/${callerItem.fileName}`);

				let description = `${canShowFileNames ? callerItem.getFileName() : ''} @ ${callerItem.position.toString()}`;

				if (clickJumpLocation === ClickJumpLocation.symbolDefinition) {
					let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${callerItem.name}`);

					let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

					callerItemPosition = new vscode.Position(funcInfo.position - 1, 0);

					fileLocation = vscode.Uri.file(`${this.cwd}/${funcInfo.fileName}`);

					description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.position.toString()}`;
				}

				let callerItemRange = new vscode.Range(callerItemPosition, callerItemPosition);

				let fromCaller = new CallHierarchyItem(
					vscode.SymbolKind.Function,
					callerItem.name,
					description,
					fileLocation,
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

				let config = vscode.workspace.getConfiguration('ccallhierarchy');
				let canShowFileNames = config.get('showFileNamesInSearchResults');
				let clickJumpLocation = config.get('clickJumpLocation');

				let calleeItemPosition = new vscode.Position(calleeItem.position - 1, 0);

				let fileLocation = vscode.Uri.file(`${this.cwd}/${calleeItem.fileName}`);

				let description = `${canShowFileNames ? calleeItem.getFileName() : ''} @ ${calleeItem.position.toString()}`;

				if (clickJumpLocation === ClickJumpLocation.symbolDefinition) {
					let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${calleeItem.name}`);

					let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

					calleeItemPosition = new vscode.Position(funcInfo.position - 1, 0);

					fileLocation = vscode.Uri.file(`${this.cwd}/${funcInfo.fileName}`);

					description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.position.toString()}`;
				}

				let calleeItemRange = new vscode.Range(calleeItemPosition, calleeItemPosition);

				let toCallee = new CallHierarchyItem(
					vscode.SymbolKind.Function,
					calleeItem.name,
					description,
					fileLocation,
					calleeItemRange,
					calleeItemRange);

				ranges.push(calleeItemRange);

				outgoingCalls.push(new vscode.CallHierarchyOutgoingCall(toCallee, ranges));
			}

			return outgoingCalls;
		}
	}
}

export async function buildDatabase() {
	showMessage('Building Database...');

	await doCLI(`cscope.exe -Rcb`);

	showMessage('Finished building database');
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

export async function doCLI(command: string): Promise<string> {
	let dir = getWorkspaceRootPath();

	return new Promise((resolve, reject) => {
		process.exec(
			command,
			{ cwd: dir },
			(error: process.ExecException | null, stdout: string, stderr: string) => {
				if (error) {
					showMessage(`exec error: ${error}`, LogLevel.error);
					showMessage(stderr, LogLevel.error);
					reject(stderr);
				} else {
					resolve(stdout);
				}
			});
	});
}

export function getWorkspaceRootPath(): string {
	return vscode.workspace.workspaceFolders !== undefined ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
}

export function showMessage(msg: string, logLevl: LogLevel = LogLevel.info) {
	let config = vscode.workspace.getConfiguration('ccallhierarchy');
	let canShowMessages = config.get('showMessages');

	if (canShowMessages) {
		switch (logLevl) {
			case LogLevel.info:
				vscode.window.showInformationMessage(msg);
				break;
			case LogLevel.warn:
				vscode.window.showWarningMessage(msg);
				break;
			case LogLevel.error:
				vscode.window.showErrorMessage(msg);
				break;
			default:
				break;
		}
	}
}