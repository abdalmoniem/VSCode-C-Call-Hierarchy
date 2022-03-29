import * as vscode from 'vscode';
import * as cp from 'child_process';

let functionsDictionary: Dictionary<FuncInfo>;
let treeRoot: Array<FuncInfo>;
let cCallHierarchyViewProvider: CCallHierarchyProvider;

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

	private _onDidChangeTreeData: vscode.EventEmitter<TreeViewItem | undefined | null | void> = new vscode.EventEmitter<TreeViewItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TreeViewItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private treeDepth: number = 0;

	refresh(treeDepth: number): void {
		this._onDidChangeTreeData.fire();
		this.treeDepth = treeDepth;
	}

	getTreeItem(element: TreeViewItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeViewItem): Thenable<TreeViewItem[]> {
		if (element) {
			return Promise.resolve(this.getFuncInfo(element.funcInfo));
		}
		return Promise.resolve(this.getFuncInfo());
	}

	/**
	 * Given the path to package.json, read all its dependencies and devDependencies.
	 */
	private getFuncInfo(func?: FuncInfo): TreeViewItem[] {
		let res: Array<TreeViewItem> = <TreeViewItem[]>[];

		if (func === undefined) {
			treeRoot.forEach (element => {
				this.treeDepth -= this.treeDepth !== 0 ? 1 : 0;

				let item: TreeViewItem = new TreeViewItem(
					element.funcName,
					'',
					element.fileName,
					(this.treeDepth <= 0) ?
						vscode.TreeItemCollapsibleState.None :
						vscode.TreeItemCollapsibleState.Expanded,
						element);

				res.push(item);
			});
		} else {
			func.callee.forEach(element => {
				this.treeDepth -= this.treeDepth !== 0 ? 1 : 0;

				let item: TreeViewItem = new TreeViewItem(
					element.funcInfo.funcName,
					element.pos.toString(),
					func.fileName,
					(this.treeDepth <= 0) ?
						vscode.TreeItemCollapsibleState.None :
						vscode.TreeItemCollapsibleState.Expanded,
					element.funcInfo);

				res.push(item);
			});
		}
		return res;
	}
}

export function showTree(offset: string, funcInfo: FuncInfo) {
	console.log(offset + ' ' + funcInfo.funcName);
	funcInfo.callee.forEach(callee => {
		showTree(offset + '+', callee.funcInfo);
	});
}

export async function buildDatabase() {
	vscode.window.showInformationMessage('Building Database...');
	
	await doCLI(`cscope.exe -Rcb`);
	
	vscode.window.showInformationMessage('Finished building database');
}

export async function findCaller() {
	functionsDictionary = {};
	treeRoot = [];

	let word = await getWord();
	let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${word} `);
	let base = FuncInfo.convertToFuncInfo(definition as string);

	await buildGraph(base.funcName, treeRoot);

	let treeDepth = getTreeDepth(treeRoot[0]);

	cCallHierarchyViewProvider.refresh(treeDepth);

	vscode.commands.executeCommand(`cHierarchyView.focus`);
}

export function getTreeDepth(funcInfo: FuncInfo): number {

	if ((funcInfo === undefined) || (funcInfo.callee === undefined) || (funcInfo.callee.length <= 0)) {
		return 1;
	}

	return 1 + getTreeDepth(funcInfo.callee[0].funcInfo);
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
	let definition = await doCLI(`cscope.exe -d -f cscope.out -L1 ${funcName} `);
	let base = FuncInfo.convertToFuncInfo(definition as string);
	functionsDictionary[base.funcName] = base;

	// Find caller functions
	let data: string = await doCLI(`cscope.exe -d -f cscope.out -L3 ${funcName} `) as string;
	
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
		vscode.commands.executeCommand('editor.action.addSelectionToNextFindMatch').then(() => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showInformationMessage('NO text editor selected');
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


	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('cCallHierarchy.build', buildDatabase);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.findcaller', findCaller);
	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand('cCallHierarchy.gotodef', gotoDef);
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('cCallHierarchy.gotoline', gotoLine);
	context.subscriptions.push(disposable);

	treeRoot = new Array<FuncInfo>();

	cCallHierarchyViewProvider = new CCallHierarchyProvider();
	vscode.window.createTreeView('cHierarchyView', { treeDataProvider: cCallHierarchyViewProvider });
}

// this method is called when your extension is deactivated
export function deactivate() { }
