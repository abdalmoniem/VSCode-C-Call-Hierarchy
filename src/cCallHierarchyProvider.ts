import * as fs from 'fs';
import * as vscode from 'vscode';
import * as childProcess from 'child_process';

let CSCOPE_PATH = 'cscope';
let CTAGS_PATH = 'ctags';
let READTAGS_PATH = 'readtags';

export function getCSCOPE_PATH(): string {
   return CSCOPE_PATH;
}

export function getCTAGS_PATH(): string {
   return CTAGS_PATH;
}

export function getREADTAGS_PATH(): string {
   return READTAGS_PATH;
}

export function setCSCOPE_PATH(path: string): void {
   CSCOPE_PATH = path;
}

export function setCTAGS_PATH(path: string): void {
   CTAGS_PATH = path;
}

export function setREADTAGS_PATH(path: string): void {
   READTAGS_PATH = path;
}

export enum ClickJumpLocation {
	SymbolDefinition = 'Symbol Definition',
	SymbolCall = 'Symbol Call'
}

export enum LogLevel {
	INFO,
	WARN,
	ERROR
}

export enum DatabaseType {
	CSCOPE = 1,
	CTAGS = 2,
	BOTH = 3
}

export class FuncInfo {
   name: string;
   filePath: string;
   description: string;
   linePosition: number;

   constructor(name?: string, filePath?: string, position?: number, description?: string) {
      this.name = name ?? '';
      this.filePath = filePath ?? '';
      this.linePosition = position ?? -1;

      this.description = description ?? '';
   }

   public static convertToFuncInfo(line: string): FuncInfo {
      let lineSplit = line.split(/\s+/);
      return new FuncInfo(lineSplit[1], lineSplit[0], Number(lineSplit[2]));
   }

   public getFileName(): string {
      let folders = this.filePath.split(/[\\/]/);

      return folders.slice(-1)[0];
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
      token: vscode.CancellationToken): Promise<vscode.CallHierarchyItem | vscode.CallHierarchyItem[] | undefined> {
      let buildOption = 0;
      let infoMessage = '';

      if (!fs.existsSync(`${this.cwd}/cscope.out`)) {
         infoMessage += `cscope database doesn't exist, rebuilding...\n`;
         buildOption |= 1 << 0;
      }

      if (!fs.existsSync(`${this.cwd}/ctags.out`)) {
         infoMessage += `ctags database doesn't exist, rebuilding...`;
         buildOption |= 1 << 1;
      }

      if (buildOption > 0) {
         showMessageWindow(infoMessage);
         await buildDatabase(buildOption as DatabaseType);
      }

      let wordRange = document.getWordRangeAtPosition(position);

      if (wordRange !== undefined) {
         let symbol = new FuncInfo(
            document.getText(wordRange),
            document.fileName.replace(this.cwd, '').replace(/[\\/]+/, ''),
            position.line + 1);

         let { description, filePath, symbolRange } = await this.getSymbolInfo(symbol, symbol.name, wordRange);

         let item = new vscode.CallHierarchyItem(
            await getSymbolKind(symbol.name),
            symbol.name,
            description,
            filePath,
            symbolRange,
            symbolRange);

         return item;
      }

      return undefined;
   }

   async provideCallHierarchyIncomingCalls(
      item: vscode.CallHierarchyItem,
      token: vscode.CancellationToken): Promise<vscode.CallHierarchyIncomingCall[]> {
      let incomingCalls: Array<vscode.CallHierarchyIncomingCall> = new Array();

      let callers = await findCallers(item.name);

      for (let callerItem of callers) {
         let { description, filePath, symbolRange } = await this.getSymbolInfo(callerItem, item.name);

         let fromCaller = new vscode.CallHierarchyItem(
            await getSymbolKind(callerItem.name),
            callerItem.name,
            description,
            filePath,
            symbolRange,
            symbolRange);

         incomingCalls.push(new vscode.CallHierarchyIncomingCall(fromCaller, [symbolRange]));
      }

      return incomingCalls;
   }

   async provideCallHierarchyOutgoingCalls(
      item: vscode.CallHierarchyItem,
      token: vscode.CancellationToken): Promise<vscode.CallHierarchyOutgoingCall[]> {
      let outgoingCalls: Array<vscode.CallHierarchyOutgoingCall> = new Array();

      let callees = await findCallees(item.name);

      for (let calleeItem of callees) {
         let { description, filePath, symbolRange } = await this.getSymbolInfo(calleeItem, calleeItem.name);

         let toCallee = new vscode.CallHierarchyItem(
            await getSymbolKind(calleeItem.name),
            calleeItem.name,
            description,
            filePath,
            symbolRange,
            symbolRange);

         outgoingCalls.push(new vscode.CallHierarchyOutgoingCall(toCallee, [symbolRange]));
      }

      return outgoingCalls;
   }

   private async getSymbolInfo(symbol: FuncInfo, relative: string, range?: vscode.Range) {
      let config = vscode.workspace.getConfiguration('ccallhierarchy');
      let canShowFileNames = config.get('showFileNamesInSearchResults');
      let clickJumpLocation = config.get('clickJumpLocation');

      let symbolRange = range ?? await this.getWordRange(`${this.cwd}/${symbol.filePath}`, symbol.linePosition - 1, relative);

      let filePath = vscode.Uri.file(`${this.cwd}/${symbol.filePath}`);

      let description = `${canShowFileNames ? symbol.getFileName() : ''} @ ${symbol.linePosition.toString()}`;

      if (clickJumpLocation === ClickJumpLocation.SymbolDefinition) {
         let definition = await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L1 ${relative}`);

         if (definition.length > 0) {
            let funcInfo = FuncInfo.convertToFuncInfo(definition as string);

            symbolRange = await this.getWordRange(`${this.cwd}/${funcInfo.filePath}`, funcInfo.linePosition - 1, funcInfo.name);

            filePath = vscode.Uri.file(`${this.cwd}/${funcInfo.filePath}`);

            description = `${canShowFileNames ? funcInfo.getFileName() : ''} @ ${funcInfo.linePosition.toString()}`;
         }
      }
      return { description, filePath, symbolRange };
   }

   private async getWordRange(filePath: string, linePosition: number, word: string) {
      let document = await vscode.workspace.openTextDocument(filePath);
      let text = document.lineAt(linePosition);

      let wordIndex = new RegExp(`\\b${word}\\b`, "i").exec(text.text)!.index;

      let callerItemPositionStart = new vscode.Position(linePosition, wordIndex);
      let callerItemPositionEnd = new vscode.Position(linePosition, wordIndex + word.length);
      let callerItemRange = new vscode.Range(callerItemPositionStart, callerItemPositionEnd);

      return callerItemRange;
   }
}

export async function buildDatabase(buildOption: DatabaseType) {
   await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      // location: vscode.ProgressLocation.Window,
      // title: "Database Build",
      // cancellable: true
   }, async (progress/* , token */) => {
      // token.onCancellationRequested(() => {
      // 	console.log("User canceled the long running operation");
      // });

      if ((buildOption === DatabaseType.CSCOPE) || (buildOption === DatabaseType.BOTH)) {
         progress.report({ increment: 0, message: "Building Database..." });

         // showMessageWindow('Building cscope Database...');

         await doCLI(`${CSCOPE_PATH} -Rcbkf cscope.out`);

         await delay(500);
      }

      if ((buildOption === DatabaseType.CTAGS) || (buildOption === DatabaseType.BOTH)) {
         progress.report({ increment: 50, message: "Building ctags database..." });

         // showMessageWindow('Building ctags Database...');

         await doCLI(`${CTAGS_PATH} --fields=+i -Rno ctags.out`);

         await delay(500);
      }
      progress.report({ increment: 100, message: "Finished building database" });

      // showMessageWindow('Finished building database');

      await delay(1500);
   });
}

export async function findCallers(funcName: string): Promise<Array<FuncInfo>> {
   let callers: Array<FuncInfo> = new Array();

   let data: string = await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L3 ${funcName}`) as string;

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

   let data: string = await doCLI(`${CSCOPE_PATH} -d -f cscope.out -L2 ${funcName}`) as string;

   let lines = data.split('\n');

   for (let line of lines) {
      if (line.length > 0) {
         let funcInfo = FuncInfo.convertToFuncInfo(line);
         callees.push(funcInfo);
      }
   }

   return callees;
}

export async function getSymbolKind(symbolName: string): Promise<vscode.SymbolKind> {
   let data = process.platform === 'win32' ?
      await doCLI(`${READTAGS_PATH} -t ctags.out -F "(list $name \\" \\" $input \\" \\" $line \\" \\" $kind #t)" ${symbolName}`) :
      await doCLI(`${READTAGS_PATH} -t ctags.out -F '(list $name " " $input " " $line " " $kind #t)' ${symbolName}`);

   let lines = data.split(/\n/);

   let kind: vscode.SymbolKind = vscode.SymbolKind.Constant;

   for (let line of lines) {
      let fields = line.split(/\s+/);

      if (fields.length >= 4) {
         switch (fields[3]) {
            case 'd':
               kind = vscode.SymbolKind.Constant;
               break;
            case 'e':
               kind = vscode.SymbolKind.Enum;
               break;
            case 'f':
               kind = vscode.SymbolKind.Function;
               break;
            case 'g':
               kind = vscode.SymbolKind.EnumMember;
               break;
            case 'h':
               kind = vscode.SymbolKind.File;
               break;
            case 'l':
               kind = vscode.SymbolKind.Variable;
               break;
            case 'm':
               kind = vscode.SymbolKind.Field;
               break;
            case 'p':
               kind = vscode.SymbolKind.Function;
               break;
            case 's':
               kind = vscode.SymbolKind.Struct;
               break;
            case 't':
               kind = vscode.SymbolKind.Class;
               break;
            case 'u':
               kind = vscode.SymbolKind.Struct;
               break;
            case 'v':
               kind = vscode.SymbolKind.Variable;
               break;
            case 'x':
               kind = vscode.SymbolKind.Variable;
               break;
            case 'z':
               kind = vscode.SymbolKind.TypeParameter;
               break;
            case 'L':
               kind = vscode.SymbolKind.Namespace;
               break;
            case 'D':
               kind = vscode.SymbolKind.TypeParameter;
               break;
            default:
               kind = vscode.SymbolKind.Class;
               break;
         }
      }
   }

   return kind;
}

export async function doCLI(command: string): Promise<string> {
   let dir = getWorkspaceRootPath();

   return new Promise((resolve, reject) => {
      childProcess.exec(
         command,
         { cwd: dir },
         async (error: childProcess.ExecException | null, stdout: string, stderr: string) => {
            if (error) {
               // showMessageWindow(stderr, LogLevel.ERROR);
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

export function showMessageWindow(msg: string, logLevl: LogLevel = LogLevel.INFO) {
   let config = vscode.workspace.getConfiguration('ccallhierarchy');
   let canShowMessages = config.get('showMessages');

   if (canShowMessages) {
      switch (logLevl) {
         case LogLevel.INFO:
            vscode.window.showInformationMessage(msg);
            break;
         case LogLevel.WARN:
            vscode.window.showWarningMessage(msg);
            break;
         case LogLevel.ERROR:
            vscode.window.showErrorMessage(msg);
            break;
         default:
            break;
      }
   }
}

async function delay(ms: number) {
   return new Promise(resolve => setTimeout(resolve, ms));
}