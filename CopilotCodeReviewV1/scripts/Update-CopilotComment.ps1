<#
.SYNOPSIS
    Updates the status of an existing comment thread on an Azure DevOps pull request.

.DESCRIPTION
    This script is used by GitHub Copilot to resolve previously-created comment threads
    when the underlying issue has been addressed. It updates the thread status via the
    Azure DevOps REST API. The script is designed to fail silently to avoid blocking
    the code review process if an update fails (e.g., attempting to update a thread
    not owned by the current identity).

.PARAMETER ThreadId
    Required. The ID of the thread to update.

.PARAMETER Status
    Optional. The new status for the thread. Valid values: Active, Fixed, WontFix, Closed, Pending.
    Default is 'Fixed'.

.EXAMPLE
    .\Update-CopilotComment.ps1 -ThreadId 123 -Status Fixed
    Marks thread #123 as resolved/fixed.

.EXAMPLE
    .\Update-CopilotComment.ps1 -ThreadId 456
    Marks thread #456 as fixed (using default status).

.NOTES
    Author: Little Fort Software
    Date: February 2026
    Requires: PowerShell 5.1 or later
    
    Environment Variables Used:
    - AZUREDEVOPS_TOKEN: Authentication token (PAT or OAuth)
    - AZUREDEVOPS_AUTH_TYPE: 'Basic' for PAT, 'Bearer' for OAuth
    - ORGANIZATION: Azure DevOps organization name
    - PROJECT: Azure DevOps project name
    - REPOSITORY: Repository name
    - PRID: Pull request ID
    
    This script fails silently by design. Errors are suppressed to avoid
    interrupting the Copilot review workflow.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Thread ID to update")]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$ThreadId,

    [Parameter(Mandatory = $false, HelpMessage = "New status for the thread")]
    [ValidateSet("Active", "Fixed", "WontFix", "Closed", "Pending")]
    [string]$Status = "Fixed"
)

# Wrap entire script in try/catch for silent failure
try {
    # Read credentials from environment variables
    $token = ${env:AZUREDEVOPS_TOKEN}
    $authType = ${env:AZUREDEVOPS_AUTH_TYPE}
    $organization = ${env:ORGANIZATION}
    $project = ${env:PROJECT}
    $repository = ${env:REPOSITORY}
    $prId = ${env:PRID}

    # Validate required environment variables
    if ([string]::IsNullOrEmpty($token) -or 
        [string]::IsNullOrEmpty($organization) -or 
        [string]::IsNullOrEmpty($project) -or 
        [string]::IsNullOrEmpty($repository) -or 
        [string]::IsNullOrEmpty($prId)) {
        # Missing required env vars - exit silently
        exit 0
    }

    # Default auth type if not specified
    if ([string]::IsNullOrEmpty($authType)) {
        $authType = "Basic"
    }

    # Build authorization header
    if ($authType -eq "Bearer") {
        $headers = @{
            Authorization  = "Bearer $token"
            "Content-Type" = "application/json"
        }
    }
    else {
        $base64Auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$token"))
        $headers = @{
            Authorization  = "Basic $base64Auth"
            "Content-Type" = "application/json"
        }
    }

    # Map status to API value (lowercase)
    $statusMap = @{
        "Active"  = "active"
        "Fixed"   = "fixed"
        "WontFix" = "wontFix"
        "Closed"  = "closed"
        "Pending" = "pending"
    }
    $apiStatus = $statusMap[$Status]

    # Build the API URL
    $baseUrl = "https://dev.azure.com/$organization/$project/_apis"
    $uri = "$baseUrl/git/repositories/$repository/pullrequests/$prId/threads/$ThreadId`?api-version=7.1"

    # Build request body
    $body = @{
        status = $apiStatus
    } | ConvertTo-Json

    # Send PATCH request to update thread status
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Patch -Body $body -ErrorAction Stop

    # Log success (visible in pipeline logs but doesn't affect workflow)
    Write-Host "Thread #$ThreadId status updated to '$Status'" -ForegroundColor Green
}
catch {
    # Silent failure - do not output error or set non-zero exit code
    # This ensures Copilot workflow continues even if update fails
    Write-Host "Note: Could not update thread #$ThreadId (this is not critical)" -ForegroundColor DarkGray
}

# Always exit with success
exit 0
