// TODO: move to @sanson/core when that package is created
import { spawn } from 'child_process'

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function spawnProcess(
  command: string,
  args: string[],
  onStderr?: (chunk: string) => void,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args)
    const stdout: string[] = []
    const stderr: string[] = []

    child.stdout.on('data', (data: Buffer) => {
      stdout.push(data.toString())
    })

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr.push(chunk)
      if (onStderr) onStderr(chunk)
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn ${command}: ${err.message}`))
    })

    child.on('close', (code) => {
      const result: SpawnResult = {
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        exitCode: code ?? 1,
      }
      if (code === 0) {
        resolve(result)
      } else {
        reject(new Error(`${command} exited with code ${code}: ${result.stderr.slice(0, 1000)}`))
      }
    })
  })
}
