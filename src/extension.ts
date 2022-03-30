import * as vscode from 'vscode';
import * as cp from 'child_process';

let callGraph: Array<FuncInfo>;
let functionsDictionary: Dictionary<FuncInfo>;
let callHierarchyViewProvider: CCallHierarchyProvider;

interface Dictionary<T> {
	[Key: string]: T;
}

class FuncInfo {
	funcName: string;
	fileName: string;
	desc: string;
	pos: number;
	callee: Array<Callee>;

	constructor(funcName?: string, fileName?: string, pos?: number) {
		this.funcName = funcName ?? '';
		this.fileName = fileName ?? '';
		this.pos = pos ?? -1;

		this.desc = '';
		this.callee = new Array<Callee>();
	}

	public static convertToFuncInfo(line: string): FuncInfo {
		let lineSplit = line.split(' ');
		return new FuncInfo(lineSplit[1], lineSplit[0], Number(lineSplit[2]));
	}
}

class Callee {
	funcInfo: FuncInfo;
	pos: Number;
	desc: String;

	constructor(func: FuncInfo, pos: Number, desc: String) {
		this.funcInfo = func;
		this.pos = pos;
		this.desc = desc;
	}
}

export class TreeViewItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public line: string,
		public path: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly funcInfo: FuncInfo,
		public readonly iconPath = new vscode.ThemeIcon('symbol-function')
	) {
		super(label, collapsibleState);
		this.tooltip = `${this.label} - ${this.line}`;
		this.description = this.line;
		this.path = path;
	}

	contextValue = 'cHierarchyViewItem';
}

export class CCallHierarchyProvider implements vscode.TreeDataProvider<TreeViewItem> {

	private onDidChangeTreeDataEmitter: vscode.EventEmitter<TreeViewItem | undefined | null | void> = new vscode.EventEmitter<TreeViewItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TreeViewItem | undefined | null | void> = this.onDidChangeTreeDataEmitter.event;

	private state: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded;

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire();
	}

	async clearTree(): Promise<void> {
		callGraph = [];
		this.refresh();
	}

	async changeCollapsibleState(state: vscode.TreeItemCollapsibleState): Promise<void> {

		this.state = state;

		callGraph.forEach(node => node.funcName += ' ');
		this.refresh();

		await this.delay(100);

		callGraph.forEach(node => node.funcName = node.funcName.substring(0, node.funcName.length - 1));
		this.refresh();
	}

	getTreeItem(element: TreeViewItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeViewItem): Array<TreeViewItem> {
		if (element) {
			return this.getFuncInfo(element.funcInfo);
		}
		return this.getFuncInfo();
	}

	private getFuncInfo(func?: FuncInfo): Array<TreeViewItem> {
		let res: Array<TreeViewItem> = new Array<TreeViewItem>();

		// return root nodes if func is not defined
		if (func === undefined) {
			callGraph.forEach(element => {
				let item: TreeViewItem = new TreeViewItem(
					element.funcName,
					element.pos.toString(),
					element.fileName,
					(element.callee?.length <= 0) ?
						vscode.TreeItemCollapsibleState.None :
						this.state,
					element);

				res.push(item);
			});
		} else {
			func.callee.forEach(element => {
				let item: TreeViewItem = new TreeViewItem(
					element.funcInfo.funcName,
					element.pos.toString(),
					func.fileName,
					(element.funcInfo.callee?.length <= 0) ?
						vscode.TreeItemCollapsibleState.None :
						this.state,
					element.funcInfo);

				res.push(item);
			});
		}

		return res;
	}

	delay(ms: number) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

export async function clearSearchResults() {
	await callHierarchyViewProvider.clearTree();
}

export async function collapseSearchResults() {
	await callHierarchyViewProvider.changeCollapsibleState(vscode.TreeItemCollapsibleState.Collapsed);
}

export async function expandSearchResults() {
	await callHierarchyViewProvider.changeCollapsibleState(vscode.TreeItemCollapsibleState.Expanded);
}

export async function buildDatabase() {
	vscode.window.showInformationMessage('Building Database...');

	await doCLI(`cscope.exe -Rcb`);

	vscode.window.showInformationMessage('Finished building database');
}

export async function findCaller() {
	functionsDictionary = {};
	callGraph = [];

	let word = await getWord();
	let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${word}`);
	let base = FuncInfo.convertToFuncInfo(definition as string);

	await buildGraph(base.funcName, callGraph);

	callHierarchyViewProvider.refresh();

	vscode.commands.executeCommand(`cHierarchyView.focus`);
}

export function gotoDef(node: TreeViewItem) {
	let dir = getRoot();
	const uriref: vscode.Uri = vscode.Uri.file(dir + '/' + node.funcInfo.fileName);
	vscode.workspace.openTextDocument(uriref).then(doc => {
		vscode.window.showTextDocument(doc).then(() => {
			const line: number = node.funcInfo.pos;
			if (vscode.window.activeTextEditor === undefined) {
				return;
			}
			let reviewType: vscode.TextEditorRevealType = vscode.TextEditorRevealType.InCenter;
			if (line === vscode.window.activeTextEditor.selection.active.line) {
				reviewType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
			}
			const newSe = new vscode.Selection(line, 0, line, 0);
			vscode.window.activeTextEditor.selection = newSe;
			vscode.window.activeTextEditor.revealRange(newSe, reviewType);
		});
	});
}

export function gotoLine(node: TreeViewItem) {
	let dir = getRoot();
	const uriref: vscode.Uri = vscode.Uri.file(dir + '/' + node.path);
	vscode.workspace.openTextDocument(uriref).then(doc => {
		vscode.window.showTextDocument(doc).then(() => {
			const line: number = parseInt(node.line);
			if (vscode.window.activeTextEditor === undefined) {
				return;
			}
			let reviewType: vscode.TextEditorRevealType = vscode.TextEditorRevealType.InCenter;
			if (line === vscode.window.activeTextEditor.selection.active.line) {
				reviewType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
			}
			const newSe = new vscode.Selection(line - 1, 0, line - 1, 0);
			vscode.window.activeTextEditor.selection = newSe;
			vscode.window.activeTextEditor.revealRange(newSe, reviewType);
		});
	});
}

export async function buildGraph(funcName: string, root: Array<FuncInfo>) {
	let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${funcName}`);
	let base = FuncInfo.convertToFuncInfo(definition as string);
	functionsDictionary[base.funcName] = base;

	// Find caller functions
	let data: string = await doCLI(`cscope.exe -d -f cscope.out -L3 ${funcName}`) as string;

	// If no caller it means it is root.
	let lines = data.split('\n');
	if (lines.length <= 1) {
		root.push(base);
		return;
	}

	for (let line of lines) {
		let info: FuncInfo;

		if (line.length > 3) {
			let tempCaller = FuncInfo.convertToFuncInfo(line);
			let caller = functionsDictionary[tempCaller.funcName];
			if (caller === undefined) {
				await buildGraph(tempCaller.funcName, root);
				caller = functionsDictionary[tempCaller.funcName];
			}
			let callee = new Callee(functionsDictionary[base.funcName], tempCaller.pos, tempCaller.desc);
			caller.callee.push(callee);
		}
	}
}

export async function doCLI(command: string) {

	let dir = getRoot();
	return new Promise((resolve, reject) => {
		cp.exec(command, { cwd: dir }, (error: cp.ExecException | null, stdout: string) => {
			if (error) {
				console.error(`exec error: ${error}`);
				return;
			}
			resolve(stdout);
		});
	});
}

export function getWord() {
	return new Promise((resolve, reject) => {
		vscode.commands.executeCommand('editor.action.moveSelectionToNextFindMatch').then(() => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('No text editor selected!');
				return;
			}
			const text = editor.document.getText(editor.selection);
			resolve(text);
		});
	});
}

export function getRoot(): string {
	return vscode.workspace.workspaceFolders !== undefined ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
}

/**
 * this method is called when your extension is activated
 * your extension is activated the very first time the command is executed
 */
export function activate(context: vscode.ExtensionContext) {
	callGraph = new Array<FuncInfo>();
	callHierarchyViewProvider = new CCallHierarchyProvider();

	let disposable = vscode.commands.registerCommand('cCallHierarchy.clearSearch', clearSearchResults);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.collapseSearch', collapseSearchResults);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.expandSearch', expandSearchResults);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.build', buildDatabase);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.findcaller', findCaller);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.gotodef', gotoDef);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.gotoline', gotoLine);
	context.subscriptions.push(disposable);

	vscode.window.createTreeView('cHierarchyView', {
		treeDataProvider: callHierarchyViewProvider,
		canSelectMany: false
	});
}

// this method is called when your extension is deactivated
export function deactivate() { }
