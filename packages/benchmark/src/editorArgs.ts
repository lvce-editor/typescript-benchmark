export const getEditorArgs = (port: number, userDataDir: string, fixtureFile: string): string[] => [
  '--wait', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
  fixtureFile,
]
