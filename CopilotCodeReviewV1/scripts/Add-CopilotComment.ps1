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
    [string]$Comment,

    [Parameter(Mandatory = $false, HelpMessage = "Status for the new thread: Active or Closed")]
    [ValidateSet("Active", "Closed")]
    [string]$Status = 'Active'
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Use the provided Status parameter (default: Active). The prompt should pass -Status when possible.
Write-Host "Posting comment with thread status: $Status" -ForegroundColor DarkGray

& "$scriptDir\Add-AzureDevOpsPRComment.ps1" `
    -Token ${env:AZUREDEVOPS_TOKEN} `
    -AuthType ${env:AZUREDEVOPS_AUTH_TYPE} `
    -Organization ${env:ORGANIZATION} `
    -Project ${env:PROJECT} `
    -Repository ${env:REPOSITORY} `
    -Id ${env:PRID} `
    -Comment $Comment `
    -Status $Status
