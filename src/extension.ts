/**
 * Additional features
 *
 *
 * 1. ✅ User to config their own API key
 * 2. ✅ User to config select the team to create the task in
 * 3. ✅ User to config select the project to create the task in
 * 4. ✅ Select cycle to create the task in
 * 5. ✅ Select status to set for created tasks
 * 6. Take highlight text and add it to the task description in a code block
 *    with a deep link back to the code, line number and file name
 */
import * as vscode from 'vscode'
import { LinearClient } from '@linear/sdk'

let linearClient: LinearClient | undefined

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
      title: 'Create Linear Task from TODO',
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
  linearClient.user
  const teams = await linearClient.teams()
  const team = teams.nodes[0].id
  vscode.window.showInformationMessage(
    `${JSON.stringify({ hello: 'world', team }, null, 2)}`
  )
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
  const lineTextEnd = editor.document.lineAt(editor.selection.end.line).text
  if (lineText !== lineTextEnd) {
    vscode.window.showInformationMessage(
      'Selection spans multiple lines. Please select a single line with a TODO comment'
    )
    return
  }
  const todoMatch = lineText.match(/\/\/\s*TODO:\s*(.*)/)
  if (!todoMatch) {
    vscode.window.showInformationMessage('No TODO: comment found on this line')
    return
  }

  const todoText = todoMatch[1].trim()

  // Prompt for task title
  const taskTitle = await vscode.window.showInputBox({
    prompt: 'Enter task title',
    value: todoText,
  })

  if (!taskTitle) {
    return // User cancelled
  }
  const teams = await linearClient.teams()
  const team = teams.nodes[0]

  try {
    // Create issue using Linear SDK
    const issue = await linearClient.createIssue({
      title: taskTitle,
      teamId: team.id,
      stateId: vscode.workspace.getConfiguration('linearTodo').get('statusId'),
      projectId: vscode.workspace
        .getConfiguration('linearTodo')
        .get('projectId'),
      description: `Created from linear vscode TODO {deep link back to github link where todo is}: ${todoText}`,
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

  vscode.window.showInformationMessage(JSON.stringify(cycleNames, null, 2))

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
