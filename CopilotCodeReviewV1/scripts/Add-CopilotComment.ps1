<#
.SYNOPSIS
    Posts a comment to a pull request in Azure DevOps.

.DESCRIPTION
    This script is used by GitHub Copilot to add a comment to a pull request.
    It simplifies the calling process by populating the necessary parameters automatically.

.PARAMETER Comment
    Required. The comment text to post. Supports markdown formatting.

.EXAMPLE
    .\Add-CopilotComment.ps1 -Comment "This looks good!"
    Creates a new comment thread.

.NOTES
    Author: Little Fort Software
    Date: December 2025
    Requires: PowerShell 5.1 or later
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Comment text to post")]
    [ValidateNotNullOrEmpty()]
    [string]$Comment
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& "$scriptDir\Add-AzureDevOpsPRComment.ps1" `
    -PAT ${env:AZUREDEVOPSPAT} `
    -Organization ${env:ORGANIZATION} `
    -Project ${env:PROJECT} `
    -Repository ${env:REPOSITORY} `
    -Id ${env:PRID} `
    -Comment $Comment
