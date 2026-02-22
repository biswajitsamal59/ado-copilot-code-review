<#
.SYNOPSIS
    Deletes a comment from a pull request thread in Azure DevOps.

.DESCRIPTION
    This script is used by GitHub Copilot to delete previously-created comments.
    It can delete individual comments within a thread. Note that deleting all comments
    in a thread does not delete the thread itself. The script is designed to fail
    silently to avoid blocking the code review process.

.PARAMETER ThreadId
    Required. The ID of the thread containing the comment.

.PARAMETER CommentId
    Required. The ID of the comment to delete.

.EXAMPLE
    .\Delete-CopilotComment.ps1 -ThreadId 123 -CommentId 456
    Deletes comment #456 from thread #123.

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
    
    Important: You can only delete comments that were created by the same identity
    (Build Service or PAT user) making the delete request.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Thread ID containing the comment")]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$ThreadId,

    [Parameter(Mandatory = $true, HelpMessage = "Comment ID to delete")]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$CommentId
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
        # Missing required env vars - log a warning so the issue is visible in pipeline logs
        $missing = @()
        if ([string]::IsNullOrEmpty($token)) { $missing += 'AZUREDEVOPS_TOKEN' }
        if ([string]::IsNullOrEmpty($organization)) { $missing += 'ORGANIZATION' }
        if ([string]::IsNullOrEmpty($project)) { $missing += 'PROJECT' }
        if ([string]::IsNullOrEmpty($repository)) { $missing += 'REPOSITORY' }
        if ([string]::IsNullOrEmpty($prId)) { $missing += 'PRID' }
        Write-Warning "Delete-CopilotComment: Skipping deletion of comment #$CommentId in thread #$ThreadId — required environment variable(s) not set: $($missing -join ', ')"
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

    # Build the API URL for deleting a comment
    $baseUrl = "https://dev.azure.com/$organization/$project/_apis"
    $uri = "$baseUrl/git/repositories/$repository/pullrequests/$prId/threads/$ThreadId/comments/$CommentId`?api-version=7.1"

    # Send DELETE request
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Delete -ErrorAction Stop

    # Log success (visible in pipeline logs but doesn't affect workflow)
    Write-Host "Comment #$CommentId in thread #$ThreadId deleted" -ForegroundColor Green
}
catch {
    # Non-blocking failure - log detailed error info but don't fail the pipeline
    $errorMsg = "Delete-CopilotComment: Could not delete comment #$CommentId in thread #$ThreadId"

    $statusCode = $null
    $errorDetail = $null
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
    }
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $errorDetail = $_.ErrorDetails.Message
    }

    if ($statusCode) {
        $errorMsg += " (HTTP $statusCode)"
    }
    if ($errorDetail) {
        $errorMsg += " — API response: $errorDetail"
    }
    elseif ($_.Exception.Message) {
        $errorMsg += " — $($_.Exception.Message)"
    }

    Write-Warning $errorMsg
}

# Always exit with success
exit 0
