import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });
  const testsRoot = __dirname;
  for (const entry of fs.readdirSync(testsRoot)) {
    if (entry.endsWith('.test.js')) {
      mocha.addFile(path.resolve(testsRoot, entry));
    }
  }
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} integration test(s) failed`));
      else resolve();
    });
  });
}
