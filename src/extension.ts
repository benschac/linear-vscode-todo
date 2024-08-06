/**
 * Additional features
 *
 *
 * 1. ✅ User to config their own API key
 * 2. ✅ User to config select the team to create the task in
 * 3. ✅ User to config select the project to create the task in
 * 4. ✅ Select cycle to create the task in
 * 5. ✅ Select status to set for created tasks
 * 6. ✅ Take highlight text and add it to the task description in a code block
 *    with a deep link back to the code, line number and file name
 */
import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

import { LinearClient } from '@linear/sdk'

let linearClient: LinearClient | undefined

class LinearTodoCodeHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    const lineText = document.lineAt(position.line).text
    const todoMatch = lineText.match(/\/\/\s*TODO:/)

    if (todoMatch) {
      const todoStart = lineText.indexOf('TODO:')
      const todoEnd = todoStart + 4 // Length of "TODO"
      const range = new vscode.Range(
        position.line,
        todoStart,
        position.line,
        todoEnd
      )
      if (!range.contains(position)) {
        return undefined
      }

      try {
        const linearTaskRegex = /[A-Z]{3,5}-\d+/
        const linearTaskMatch = lineText.match(linearTaskRegex)
        if (!linearTaskMatch) {
          return undefined
        }
        const issue = await linearClient?.issue(linearTaskMatch?.[0])
        const markdown = new vscode.MarkdownString()
        markdown.appendMarkdown(
          `[${issue?.identifier} ${issue?.title}](${issue?.url}) by ${
            (await issue?.creator)?.name
          }`
        )

        return new vscode.Hover(markdown, range)
      } catch (e: unknown) {
        console.error(e)
      }
    }

    return undefined
  }
}

class LinearTodoCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    // Check if the selected text contains a TODO: comment
    const lineText = document.lineAt(range.start.line).text
    if (!/\/\/\s*TODO:/.test(lineText)) {
      return []
    }

    const createLinearTaskAction = new vscode.CodeAction(
      'Create Linear Task from TODO',
      vscode.CodeActionKind.QuickFix
    )
    createLinearTaskAction.command = {
      title: 'Create Linear Task',
      command: 'extension.createLinearTask',
    }

    return [createLinearTaskAction]
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Linear TODO extension is now active')
  updateLinearClient()

  let createTask = vscode.commands.registerCommand(
    'extension.createLinearTask',
    createLinearTask
  )
  let configureApiKey = vscode.commands.registerCommand(
    'extension.configureLinearApiKey',
    configureLinearApiKey
  )

  let configureTeam = vscode.commands.registerCommand(
    'extension.configureLinearTeam',
    configureLinearTeam
  )
  let configureProject = vscode.commands.registerCommand(
    'extension.configureLinearProject',
    configureLinearProject
  )

  let configureCycle = vscode.commands.registerCommand(
    'extension.configureLinearCycle',
    configureLinearCycle
  )

  let configureTaskStatus = vscode.commands.registerCommand(
    'extension.configureLinearTaskStatus',
    configureLinearTaskStatus
  )

  context.subscriptions.push(createTask)
  context.subscriptions.push(configureApiKey)
  context.subscriptions.push(configureTeam)
  context.subscriptions.push(configureProject)
  context.subscriptions.push(configureCycle)
  context.subscriptions.push(configureTaskStatus)

  const hoverActionProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file', language: '*' },
    new LinearTodoCodeHoverProvider()
  )

  context.subscriptions.push(hoverActionProvider)

  // Register the Code Action Provider
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file', language: '*' },
    new LinearTodoCodeActionProvider(),
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  )
  context.subscriptions.push(codeActionProvider)
  // Listen for configuration changes
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('linearTodo.apiKey')) {
      updateLinearClient()
    }
  })
}

async function updateLinearClient() {
  if (!vscode.workspace.getConfiguration('linearTodo').get('apiKey')) {
    vscode.window.showInformationMessage(
      'Linear API key is not set. Please set it in the extension settings.'
    )
    return
  }

  linearClient = new LinearClient({
    apiKey: vscode.workspace.getConfiguration('linearTodo').get('apiKey'),
  })
}

async function createLinearTask() {
  if (!linearClient) {
    vscode.window.showErrorMessage(
      'Linear API key is not set. Please set it in the extension settings.'
    )
    return
  }

  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage('No active editor found')
    return
  }

  const lineText = editor.document.lineAt(editor.selection.start.line).text
  const todoMatch = lineText.match(/\/\/\s*TODO:\s*(.*)/)
  if (!todoMatch) {
    vscode.window.showInformationMessage('No TODO: comment found on this line')
    return
  }

  const todoText = todoMatch[1].trim()

  const taskTitle = await vscode.window.showInputBox({
    prompt: 'Enter task title',
    value: todoText,
  })

  if (!taskTitle) {
    return
  }
  const teams = await linearClient.teams()
  const team = teams.nodes[0]

  // Create description deep link back to github link where todo is

  try {
    // Get the file path relative to the workspace root
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      editor.document.uri
    )
    const relativeFilePath = workspaceFolder
      ? vscode.workspace.asRelativePath(editor.document.uri, false)
      : editor.document.uri.fsPath

    const { selection } = editor
    const highlightedText = editor.document.getText(selection).trim()

    const { branch, url } = await getRepositoryInfo()
    const issue = await linearClient.createIssue({
      title: taskTitle,
      teamId: team.id,
      stateId: vscode.workspace.getConfiguration('linearTodo').get('statusId'),
      projectId: vscode.workspace
        .getConfiguration('linearTodo')
        .get('projectId'),
      description: `Created from linear vscode TODO: ${todoText}\n\nHighlighted code:\n\`\`\`\n${highlightedText}\n\`\`\`\n\nSource: ${url}/blob/${branch}/${relativeFilePath}#L${selection.start.line}`,
    })

    if (issue.success) {
      const action = await vscode.window.showInformationMessage(
        `Linear task created at: ${(await issue?.issue)?.url}`,
        'Open in Linear'
      )

      if (action === 'Open in Linear') {
        if (!issue.issue) {
          return
        }
        vscode.env.openExternal(vscode.Uri.parse((await issue?.issue).url))
      }

      // Update the TODO comment with the issue identifier
      const newText = lineText.replace(
        /\/\/\s*TODO:/,
        `// TODO: ${(await issue.issue)?.identifier}`
      )
      new vscode.Hover('thing')
      const range = editor.document.lineAt(editor.selection.start.line).range
      await editor.edit((editBuilder) => {
        editBuilder.replace(range, newText)
      })
    }
  } catch (error) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(
        `Failed to create Linear task: ${error.message}`
      )
    }
  }
}

async function configureLinearTeam() {
  const teams = await linearClient?.teams()
  if (!teams) {
    vscode.window.showErrorMessage('Failed to fetch teams from Linear')
    return
  }

  const teamNames = teams.nodes.map((team) => team.name)
  const selectedTeam = await vscode.window.showQuickPick(teamNames, {
    placeHolder: 'Select the team to create tasks in',
  })

  if (selectedTeam) {
    const team = teams.nodes.find((team) => team.name === selectedTeam)
    if (team) {
      await vscode.workspace
        .getConfiguration('linearTodo')
        .update('teamId', team.id, true)
      vscode.window.showInformationMessage(`Team has been set to: ${team.name}`)
    }
  }
}
async function configureLinearApiKey() {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your Linear API Key',
    placeHolder: 'lin_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value: string) => {
      return value.startsWith('lin_api_')
        ? null
        : 'API Key should start with "lin_api_"'
    },
  })

  if (apiKey) {
    await vscode.workspace
      .getConfiguration('linearTodo')
      .update('apiKey', apiKey, true)
    vscode.window.showInformationMessage('Linear API Key has been updated.')
    updateLinearClient()
  }
}

async function configureLinearProject() {
  const projects = await linearClient?.projects()
  if (!projects) {
    vscode.window.showErrorMessage('Failed to fetch projects from Linear')
    return
  }

  const projectNames = projects.nodes.map((project) => project.name)
  const selectedProject = await vscode.window.showQuickPick(projectNames, {
    placeHolder: 'Select the project to create tasks in',
  })

  if (selectedProject) {
    const project = projects.nodes.find(
      (project) => project.name === selectedProject
    )
    if (project) {
      await vscode.workspace
        .getConfiguration('linearTodo')
        .update('projectId', project.id, true)
      vscode.window.showInformationMessage(
        `Project has been set to: ${project.name}`
      )
    }
  }
}

async function configureLinearCycle() {
  const cycles = await linearClient?.cycles()
  if (!cycles) {
    vscode.window.showErrorMessage('Failed to fetch cycles from Linear')
    return
  }

  const cycleNames = cycles.nodes
    .map((cycle) => cycle.name)
    .filter((name) => name !== undefined)

  if (!cycleNames || cycleNames.length === 0) {
    vscode.window.showInformationMessage('No cycles found in the team')
    return
  }

  const selectedCycle = await vscode.window.showQuickPick(cycleNames, {
    placeHolder: 'Select the cycle to create tasks in',
  })

  if (selectedCycle) {
    const cycle = cycles.nodes.find((cycle) => cycle.name === selectedCycle)
    if (cycle) {
      await vscode.workspace
        .getConfiguration('linearTodo')
        .update('cycleId', cycle.id, true)
      vscode.window.showInformationMessage(
        `Cycle has been set to: ${cycle.name}`
      )
    }
  }
}

async function configureLinearTaskStatus() {
  const statuses = await linearClient?.workflowStates()
  if (!statuses) {
    vscode.window.showErrorMessage('Failed to fetch statuses from Linear')
    return
  }

  const statusNames = statuses.nodes.map((status) => status.name)
  const selectedStatus = await vscode.window.showQuickPick(statusNames, {
    placeHolder: 'Select the status to set for created tasks',
  })

  if (selectedStatus) {
    const status = statuses.nodes.find(
      (status) => status.name === selectedStatus
    )
    if (status) {
      await vscode.workspace
        .getConfiguration('linearTodo')
        .update('statusId', status.id, true)
      vscode.window.showInformationMessage(
        `Task status has been set to: ${status.name}`
      )
    }
  }
}

export function deactivate() {}

async function getRepositoryUrl(): Promise<string | undefined> {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports
  if (gitExtension) {
    const api = gitExtension.getAPI(1)
    const repositories = api.repositories
    vscode.window.showInformationMessage(repositories, 'repositories')
    if (repositories.length > 0) {
      const remote = await repositories[0].getRemote('origin')
      if (remote) {
        let url = remote.fetchUrl || remote.pushUrl
        if (url) {
          // Convert SSH URL to HTTPS URL if necessary
          url = url.replace(/^git@([^:]+):/, 'https://$1/')
          url = url.replace(/\.git$/, '')
          return url
        }
      }
    }
  }
  return undefined
}
interface RepoInfo {
  url?: string
  branch?: string
}

async function getRepositoryInfo(): Promise<RepoInfo> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    return {}
  }

  const gitDir = path.join(workspaceFolder.uri.fsPath, '.git')

  try {
    // Check if .git directory exists
    await fs.promises.access(gitDir)

    // Read config file
    const configPath = path.join(gitDir, 'config')
    const config = await fs.promises.readFile(configPath, 'utf8')

    // Extract remote URL
    const urlMatch = config.match(/\[remote "origin"\][^\[]*url = (.*)$/m)
    const url = urlMatch?.[1]?.trim()

    // Read HEAD file to get current branch
    const headPath = path.join(gitDir, 'HEAD')
    const head = await fs.promises.readFile(headPath, 'utf8')
    const branchMatch = head.match(/ref: refs\/heads\/(.*)/)
    const branch = branchMatch?.[1]?.trim()

    return {
      url: url ? sanitizeGitUrl(url) : undefined,
      branch,
    }
  } catch (error) {
    console.error('Error reading git info:', error)
    return {}
  }
}

function sanitizeGitUrl(url: string): string {
  // Convert SSH URL to HTTPS
  url = url.replace(/^git@([^:]+):/, 'https://$1/')
  // Remove .git suffix if present
  url = url.replace(/\.git$/, '')
  return url
}
