import { defineConfig } from '@vscode/test-cli';
import * as path from 'path';
import * as os from 'os';

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const vscodeExecutablePath = path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe');
const shortAppDir = 'C:\\Users\\harsh\\OneDrive\\Desktop\\VSCODE~1\\xml-xpath';

export default defineConfig({
	files: 'C:\\Users\\harsh\\OneDrive\\Desktop\\VSCODE~1\\xml-xpath\\test\\**\\*.test.js',
	extensionDevelopmentPath: shortAppDir,
	useInstallation: {
		fromPath: vscodeExecutablePath,
	}
});
