<#
.SYNOPSIS
    Posts a comment to a pull request in Azure DevOps.

.DESCRIPTION
    This script is used by GitHub Copilot to add a comment to a pull request.
    It simplifies the calling process by populating the necessary parameters automatically
    from environment variables set by the pipeline task.

.PARAMETER Comment
    Required. The comment text to post. Supports markdown formatting.

.EXAMPLE
    .\Add-CopilotComment.ps1 -Comment "This looks good!"
    Creates a new comment thread.

.NOTES
    Author: Little Fort Software
    Date: December 2025
    Requires: PowerShell 5.1 or later
    
    Environment Variables Used:
    - AZUREDEVOPS_TOKEN: Authentication token (PAT or OAuth)
    - AZUREDEVOPS_AUTH_TYPE: 'Basic' for PAT, 'Bearer' for OAuth
    - ORGANIZATION: Azure DevOps organization name
    - PROJECT: Azure DevOps project name
    - REPOSITORY: Repository name
    - PRID: Pull request ID
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Comment text to post")]
    [ValidateNotNullOrEmpty()]
    [string]$Comment
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Determine thread status based on comment content (approval-like comments -> Closed)
# Only perform auto-detection if the corresponding task input was enabled
$status = 'Active'
$autoResolveEnv = ${env:AUTO_RESOLVE_APPROVAL_COMMENTS}
if ($null -ne $autoResolveEnv -and $autoResolveEnv.ToString().ToLower() -eq 'true') {
    try {
        if ($Comment -match '(?i)\b(looks good|lgtm|approved|no issues|no issues found|good to merge|ready to merge|approve)\b') {
            $status = 'Closed'
            Write-Host "Detected approval-like comment — setting thread status to: $status" -ForegroundColor Yellow
        }
    } catch {
        $status = 'Active'
    }
} else {
    Write-Host "Auto-resolve approval comments is disabled; posting thread with status: $status" -ForegroundColor DarkGray
}

& "$scriptDir\Add-AzureDevOpsPRComment.ps1" `
    -Token ${env:AZUREDEVOPS_TOKEN} `
    -AuthType ${env:AZUREDEVOPS_AUTH_TYPE} `
    -Organization ${env:ORGANIZATION} `
    -Project ${env:PROJECT} `
    -Repository ${env:REPOSITORY} `
    -Id ${env:PRID} `
    -Comment $Comment `
    -Status $status
