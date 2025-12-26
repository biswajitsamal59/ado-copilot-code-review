<#
.SYNOPSIS
    Posts a comment to a pull request in Azure DevOps.

.DESCRIPTION
    This script uses the Azure DevOps REST API to add a comment to a pull request.
    It can either create a new comment thread or reply to an existing thread.

.PARAMETER PAT
    Required. Personal Access Token for Azure DevOps authentication.

.PARAMETER Organization
    Required. The Azure DevOps organization name.

.PARAMETER Project
    Required. The Azure DevOps project name.

.PARAMETER Repository
    Required. The repository name where the pull request exists.

.PARAMETER Id
    Required. The pull request ID to comment on.

.PARAMETER Comment
    Required. The comment text to post. Supports markdown formatting.

.PARAMETER ThreadId
    Optional. The ID of an existing thread to reply to. If not specified, a new thread is created.

.PARAMETER Status
    Optional. The status for a new thread. Valid values: Active, Fixed, WontFix, Closed, Pending.
    Default is 'Active'. Only applies when creating a new thread (not replying).

.EXAMPLE
    .\Add-AzureDevOpsPRComment.ps1 -PAT "your-pat" -Organization "myorg" -Project "myproject" -Repository "myrepo" -Id 123 -Comment "This looks good!"
    Creates a new comment thread on pull request #123.

.EXAMPLE
    .\Add-AzureDevOpsPRComment.ps1 -PAT "your-pat" -Organization "myorg" -Project "myproject" -Repository "myrepo" -Id 123 -Comment "I agree" -ThreadId 456
    Replies to an existing thread #456 on pull request #123.

.NOTES
    Author: Little Fort Software
    Date: December 2025
    Requires: PowerShell 5.1 or later
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Personal Access Token for Azure DevOps")]
    [ValidateNotNullOrEmpty()]
    [string]$PAT,

    [Parameter(Mandatory = $true, HelpMessage = "Azure DevOps organization name")]
    [ValidateNotNullOrEmpty()]
    [string]$Organization,

    [Parameter(Mandatory = $true, HelpMessage = "Azure DevOps project name")]
    [ValidateNotNullOrEmpty()]
    [string]$Project,

    [Parameter(Mandatory = $true, HelpMessage = "Repository name")]
    [ValidateNotNullOrEmpty()]
    [string]$Repository,

    [Parameter(Mandatory = $true, HelpMessage = "Pull request ID")]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$Id,

    [Parameter(Mandatory = $true, HelpMessage = "Comment text to post")]
    [ValidateNotNullOrEmpty()]
    [string]$Comment,

    [Parameter(Mandatory = $false, HelpMessage = "Existing thread ID to reply to")]
    [int]$ThreadId,

    [Parameter(Mandatory = $false, HelpMessage = "Status for new thread")]
    [ValidateSet("Active", "Fixed", "WontFix", "Closed", "Pending")]
    [string]$Status = "Active"
)

#region Helper Functions

function Get-AuthorizationHeader {
    param([string]$PersonalAccessToken)
    
    $base64Auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$PersonalAccessToken"))
    return @{
        Authorization  = "Basic $base64Auth"
        "Content-Type" = "application/json"
    }
}

function Invoke-AzureDevOpsApi {
    param(
        [string]$Uri,
        [hashtable]$Headers,
        [string]$Method = "Get",
        [object]$Body = $null
    )
    
    try {
        $params = @{
            Uri         = $Uri
            Headers     = $Headers
            Method      = $Method
            ErrorAction = "Stop"
        }
        
        if ($null -ne $Body) {
            $params.Body = $Body | ConvertTo-Json -Depth 10
        }
        
        $response = Invoke-RestMethod @params
        return $response
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $errorMessage = $_.ErrorDetails.Message
        
        if ($statusCode -eq 401) {
            Write-Error "Authentication failed. Please verify your PAT is valid and has appropriate permissions."
        }
        elseif ($statusCode -eq 404) {
            Write-Error "Resource not found. Please verify the organization, project, repository, and PR ID."
        }
        elseif ($statusCode -eq 400) {
            Write-Error "Bad request: $errorMessage"
        }
        else {
            Write-Error "API request failed: $errorMessage (Status: $statusCode)"
        }
        return $null
    }
}

function Get-ThreadStatusValue {
    param([string]$StatusName)
    
    switch ($StatusName) {
        "Active"   { return 1 }
        "Fixed"    { return 2 }
        "WontFix"  { return 3 }
        "Closed"   { return 4 }
        "Pending"  { return 5 }
        default    { return 1 }
    }
}

#endregion

#region Main Logic

$headers = Get-AuthorizationHeader -PersonalAccessToken $PAT
$baseUrl = "https://dev.azure.com/$Organization/$Project/_apis/git/repositories/$Repository/pullrequests/$Id"
$apiVersion = "api-version=7.1"

# First, verify the PR exists
Write-Host "`nVerifying pull request #$Id exists..." -ForegroundColor Cyan
$prUrl = "$baseUrl`?$apiVersion"
$pr = Invoke-AzureDevOpsApi -Uri $prUrl -Headers $headers

if ($null -eq $pr) {
    Write-Error "Could not find pull request #$Id in repository '$Repository'."
    exit 1
}

Write-Host "Found PR: $($pr.title)" -ForegroundColor Green

if ($ThreadId -gt 0) {
    # Reply to existing thread
    Write-Host "`nReplying to thread #$ThreadId..." -ForegroundColor Cyan
    
    # Verify the thread exists
    $threadUrl = "$baseUrl/threads/$ThreadId`?$apiVersion"
    $existingThread = Invoke-AzureDevOpsApi -Uri $threadUrl -Headers $headers
    
    if ($null -eq $existingThread) {
        Write-Error "Could not find thread #$ThreadId on pull request #$Id."
        exit 1
    }
    
    # Post reply to the thread
    $commentsUrl = "$baseUrl/threads/$ThreadId/comments?$apiVersion"
    $body = @{
        content       = $Comment
        parentCommentId = 0
        commentType   = 1  # Text comment
    }
    
    $result = Invoke-AzureDevOpsApi -Uri $commentsUrl -Headers $headers -Method "Post" -Body $body
    
    if ($null -ne $result) {
        Write-Host "`n" + ("=" * 60) -ForegroundColor DarkGray
        Write-Host "COMMENT POSTED SUCCESSFULLY" -ForegroundColor Green
        Write-Host ("=" * 60) -ForegroundColor DarkGray
        Write-Host "`n  Thread ID:    #$ThreadId"
        Write-Host "  Comment ID:   #$($result.id)"
        Write-Host "  Author:       $($result.author.displayName)"
        Write-Host "  Posted:       $($result.publishedDate)"
        Write-Host "`n  Content:"
        Write-Host "  $Comment" -ForegroundColor White
        Write-Host "`n" + ("=" * 60) -ForegroundColor DarkGray
    }
}
else {
    # Create new thread
    Write-Host "`nCreating new comment thread..." -ForegroundColor Cyan
    
    $threadsUrl = "$baseUrl/threads?$apiVersion"
    $body = @{
        comments = @(
            @{
                content     = $Comment
                commentType = 1  # Text comment
            }
        )
        status   = Get-ThreadStatusValue -StatusName $Status
    }
    
    $result = Invoke-AzureDevOpsApi -Uri $threadsUrl -Headers $headers -Method "Post" -Body $body
    
    if ($null -ne $result) {
        Write-Host "`n" + ("=" * 60) -ForegroundColor DarkGray
        Write-Host "COMMENT THREAD CREATED SUCCESSFULLY" -ForegroundColor Green
        Write-Host ("=" * 60) -ForegroundColor DarkGray
        Write-Host "`n  Thread ID:    #$($result.id)"
        Write-Host "  Status:       $Status"
        Write-Host "  Comment ID:   #$($result.comments[0].id)"
        Write-Host "  Author:       $($result.comments[0].author.displayName)"
        Write-Host "  Posted:       $($result.comments[0].publishedDate)"
        Write-Host "`n  Content:"
        Write-Host "  $Comment" -ForegroundColor White
        Write-Host "`n" + ("=" * 60) -ForegroundColor DarkGray
        
        Write-Host "`nTip: Use -ThreadId $($result.id) to reply to this thread." -ForegroundColor DarkGray
    }
}

# Provide link to the PR
$webUrl = "https://dev.azure.com/$Organization/$Project/_git/$Repository/pullrequest/$Id"
Write-Host "`nView PR: $webUrl" -ForegroundColor Cyan

#endregion
