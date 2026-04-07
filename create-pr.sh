#!/bin/bash

# =============================================================================
# Automated Pull Request Creation with Conventional Commit Style
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
TARGET_BRANCH=""
CONFIRM_FLAG=""
FORCE_BRANCH=""
SKIP_ANALYSIS=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --target)
            TARGET_BRANCH="$2"
            shift 2
            ;;
        --confirm)
            CONFIRM_FLAG="true"
            shift
            ;;
        --branch)
            FORCE_BRANCH="$2"
            shift 2
            ;;
        --skip-analysis)
            SKIP_ANALYSIS="true"
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# =============================================================================
# Step 1: Detect Fork vs Upstream
# =============================================================================
echo -e "${BLUE}[1/12] Detecting fork vs upstream...${NC}"

CURRENT_USER=$(whoami)
ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "")
FORK_URL=$(git remote get-url can1357 2>/dev/null || echo "")
UPSTREAM_URL=$(git remote get-url upstream 2>/dev/null || echo "")

# Parse owner from URLs (handle both git@github.com:owner/repo and https://github.com/owner/repo)
ORIGIN_OWNER=$(echo "$ORIGIN_URL" | sed -n 's|.*github.com[/:]\([^/]*\)/.*|\1|p')
FORK_OWNER=$(echo "$FORK_URL" | sed -n 's|.*github.com[/:]\([^/]*\)/.*|\1|p')
UPSTREAM_OWNER=$(echo "$UPSTREAM_URL" | sed -n 's|.*github.com[/:]\([^/]*\)/.*|\1|p')

# Determine fork vs upstream by comparing current user to remote owners
if [[ "$ORIGIN_URL" == *"github.com"* ]] && [[ "$FORK_URL" == *"github.com"* ]]; then
    # Both origin and can1357 exist
    
    # Check if current user owns origin (then origin is their fork)
    if [[ "$ORIGIN_OWNER" == "$CURRENT_USER" ]]; then
        # Origin is the user's fork, can1357 is upstream
        UPSTREAM_REPO="$FORK_URL"
        UPSTREAM_OWNER="$FORK_OWNER"
        FORK_REPO="$ORIGIN_URL"
        FORK_OWNER="$ORIGIN_OWNER"
        IS_FORK="true"
    elif [[ "$FORK_OWNER" == "$CURRENT_USER" ]]; then
        # can1357 is user's fork, origin is upstream
        UPSTREAM_REPO="$ORIGIN_URL"
        UPSTREAM_OWNER="$ORIGIN_OWNER"
        FORK_REPO="$FORK_URL"
        FORK_OWNER="$FORK_OWNER"
        IS_FORK="true"
    else
        # Current user doesn't own either - treat origin as main repo
        UPSTREAM_REPO="$ORIGIN_URL"
        UPSTREAM_OWNER="$ORIGIN_OWNER"
        FORK_REPO="$FORK_URL"
        FORK_OWNER="$FORK_OWNER"
        IS_FORK="true"  # Can1357 is a fork we can PR from
    fi
    
    echo -e "  ${GREEN}Detected: $([ "$IS_FORK" = "true" ] && echo "Fork" || echo "Upstream")${NC}"
    echo "  Upstream: $UPSTREAM_OWNER"
    echo "  Fork: $FORK_OWNER"
elif [[ -n "$ORIGIN_URL" ]] && [[ "$ORIGIN_URL" == *"github.com"* ]]; then
    # Only origin exists
    UPSTREAM_REPO="$ORIGIN_URL"
    UPSTREAM_OWNER="$ORIGIN_OWNER"
    
    if [[ "$ORIGIN_OWNER" == "$CURRENT_USER" ]]; then
        IS_FORK="false"  # Direct to main repo
    else
        IS_FORK="true"   # Pushing to someone else's repo
    fi
    echo -e "  ${GREEN}Detected: $([ "$IS_FORK" = "true" ] && echo "Fork" || echo "Upstream")${NC}"
else
    echo -e "${RED}No GitHub remote found${NC}"
    exit 1
fi

REPO_NAME=$(echo "$UPSTREAM_REPO" | sed -n 's|.*github.com[/:][^/]*/\(.*\)\.git|\1|p' | sed -n 's|.*github.com[/:][^/]*/\(.*\)|\1|p')

# =============================================================================
# Step 2: Detect Target Branch
# =============================================================================
echo -e "${BLUE}[2/12] Detecting target branch...${NC}"

if [[ -n "$TARGET_BRANCH" ]]; then
    # Use provided target
    :
elif [[ "$REPO_NAME" == *"AxonHub"* ]] || [[ "$REPO_NAME" == *"axon"* ]]; then
    TARGET_BRANCH="unstable"
else
    # Check if develop exists, otherwise use main
    if git rev-parse --verify develop >/dev/null 2>&1; then
        TARGET_BRANCH="develop"
    elif git rev-parse --verify main >/dev/null 2>&1; then
        TARGET_BRANCH="main"
    elif git rev-parse --verify master >/dev/null 2>&1; then
        TARGET_BRANCH="master"
    else
        TARGET_BRANCH="main"
    fi
fi

echo "  Target branch: $TARGET_BRANCH"

# =============================================================================
# Step 3: Check Default Branch with Uncommitted Changes
# =============================================================================
echo -e "${BLUE}[3/12] Checking for uncommitted changes...${NC}"

CURRENT_BRANCH=$(git branch --show-current)
DEFAULT_BRANCH=""
for branch in main master develop; do
    if git rev-parse --verify "$branch" >/dev/null 2>&1; then
        DEFAULT_BRANCH="$branch"
        break
    fi
done

UNCOMMITTED=$(git status --porcelain | grep -v "^??" | wc -l)

if [[ "$CURRENT_BRANCH" == "$DEFAULT_BRANCH" ]] && [[ "$UNCOMMITTED" -gt 0 ]]; then
    echo -e "  ${YELLOW}Warning: Uncommitted changes on default branch${NC}"
    
    if [[ -n "$CONFIRM_FLAG" ]]; then
        echo -e "  ${YELLOW}--confirm flag set, proceeding...${NC}"
    else
        echo -e "${RED}Cannot create branch with uncommitted changes on default branch.${NC}"
        echo "Use --confirm to force, or commit/stash changes first."
        exit 1
    fi
fi

# =============================================================================
# Step 4: Check for Unpushed Commits
# =============================================================================
echo -e "${BLUE}[4/12] Checking for unpushed commits...${NC}"

# Determine which remote we can push to
# Priority: origin > can1357 > upstream (try until one works)
PUSH_REMOTE=""
for remote in origin can1357 upstream; do
    if git remote get-url "$remote" >/dev/null 2>&1; then
        # Try push with short timeout
        if timeout 5 git push --dry-run "$remote" HEAD >/dev/null 2>&1; then
            PUSH_REMOTE="$remote"
            break
        fi
    fi
done

if [[ -z "$PUSH_REMOTE" ]]; then
    echo -e "${RED}Cannot push to any remote${NC}"
    exit 1
fi

echo "  Push remote: $PUSH_REMOTE"

# Check if there are unpushed commits
UNPUSHED=$(git log --oneline "$PUSH_REMOTE/$TARGET_BRANCH"..HEAD 2>/dev/null | wc -l || echo "0")

if [[ "$UNPUSHED" -gt 0 ]]; then
    echo "  Found $UNPUSHED unpushed commits"
    
    # Try to push
    if git push -u "$PUSH_REMOTE" HEAD 2>&1; then
        echo -e "  ${GREEN}Successfully pushed commits${NC}"
    else
        echo -e "${RED}Failed to push commits. Stopping.${NC}"
        exit 1
    fi
else
    echo "  No unpushed commits"
fi

# =============================================================================
# Step 5: Get Current Branch Name
# =============================================================================
echo -e "${BLUE}[5/12] Getting current branch name...${NC}"

BRANCH_NAME=$(git branch --show-current)
echo "  Branch: $BRANCH_NAME"

# =============================================================================
# Step 6: Get Commits Since Base
# =============================================================================
echo -e "${BLUE}[6/12] Getting commits since base...${NC}"

COMMITS_SINCE=$(git log --oneline --no-merges "$TARGET_BRANCH"..HEAD 2>/dev/null || git log --oneline --no-merges origin/"$TARGET_BRANCH"..HEAD 2>/dev/null || echo "")
COMMITS_LIST=$(echo "$COMMITS_SINCE" | head -20)

echo "  Commits since $TARGET_BRANCH:"
echo "$COMMITS_LIST" | while read -r line; do echo "    $line"; done

# =============================================================================
# Step 7: Filter WIP Commits
# =============================================================================
echo -e "${BLUE}[7/12] Filtering WIP commits...${NC}"

WIP_PATTERN="^(WIP|wip|temp|TEMP|fixing|FIXING)"
CLEAN_COMMITS=$(echo "$COMMITS_SINCE" | grep -vE "$WIP_PATTERN" || true)

if [[ -z "$CLEAN_COMMITS" ]]; then
    echo -e "  ${YELLOW}All commits appear to be WIP${NC}"
    USE_COMMITS="$COMMITS_SINCE"
else
    USE_COMMITS="$CLEAN_COMMITS"
    echo "  Filtered WIP commits"
fi

# =============================================================================
# Step 8: Analyze Changes
# =============================================================================
echo -e "${BLUE}[8/12] Analyzing changes...${NC}"

# Get list of changed files
CHANGED_FILES=$(git diff --name-only "$TARGET_BRANCH"..HEAD 2>/dev/null | wc -l)
FILE_LIST=$(git diff --name-only "$TARGET_BRANCH"..HEAD 2>/dev/null || git diff --name-only origin/"$TARGET_BRANCH"..HEAD 2>/dev/null || echo "")

echo "  Changed files: $CHANGED_FILES"

if [[ "$CHANGED_FILES" -eq 0 ]]; then
    echo -e "  ${YELLOW}No files changed${NC}"
    PR_SUMMARY="No changes detected"
    PR_HIGHLIGHTS="N/A"
    PR_RISKS="None"
elif [[ "$CHANGED_FILES" -le 3 ]] || [[ -n "$SKIP_ANALYSIS" ]]; then
    # Direct analysis for small changes
    echo "  Direct analysis (few files)"
    
    # Extract commit messages for analysis
    COMMIT_MSGS=$(git log --format="%s" "$TARGET_BRANCH"..HEAD 2>/dev/null | head -5)
    
    # Generate summary based on commit messages and file types
    if echo "$COMMIT_MSGS" | grep -qi "fix"; then
        PR_TYPE="fix"
    elif echo "$COMMIT_MSGS" | grep -qi "feat"; then
        PR_TYPE="feat"
    elif echo "$COMMIT_MSGS" | grep -qi "refactor"; then
        PR_TYPE="refactor"
    elif echo "$COMMIT_MSGS" | grep -qi "chore"; then
        PR_TYPE="chore"
    elif echo "$COMMIT_MSGS" | grep -qi "docs"; then
        PR_TYPE="docs"
    else
        PR_TYPE="fix"
    fi
    
    # Get the main scope from changed files
    SCOPE=$(echo "$FILE_LIST" | head -1 | sed 's|.*/||' | sed 's|\..*||')
    
    PR_SUMMARY="$PR_TYPE($SCOPE): Changes detected in $CHANGED_FILES file(s)"
    PR_HIGHLIGHTS=$(echo "$FILE_LIST" | head -5 | tr '\n' ', ')
    PR_RISKS="Low - small change set"
else
    # Spawn agents for large changes (placeholder - would need actual agent spawning)
    echo "  Large change set - using aggregated analysis"
    PR_SUMMARY="Multiple files modified - requires detailed review"
    PR_HIGHLIGHTS="$CHANGED_FILES files changed"
    PR_RISKS="Review required for full assessment"
fi

echo "  Summary: $PR_SUMMARY"
echo "  Highlights: $PR_HIGHLIGHTS"

# =============================================================================
# Step 9: Generate PR Title (Conventional Commit Style)
# =============================================================================
echo -e "${BLUE}[9/12] Generating PR title...${NC}"

# Extract type from first non-WIP commit
FIRST_COMMIT_MSG=$(echo "$USE_COMMITS" | head -1 | sed 's/^[a-f0-9]* //')

# Parse conventional commit format
if [[ "$FIRST_COMMIT_MSG" =~ ^([a-z]+)(\(.+\))?:\ (.+) ]]; then
    COMMIT_TYPE="${BASH_REMATCH[1]}"
    COMMIT_SCOPE="${BASH_REMATCH[2]}"
    COMMIT_SUBJECT="${BASH_REMATCH[3]}"
    
    # Capitalize first letter
    COMMIT_TYPE="$(tr '[:lower:]' '[:upper:]' <<< "${COMMIT_TYPE:0:1}")${COMMIT_TYPE:1}"
    
    PR_TITLE="$COMMIT_TYPE$COMMIT_SCOPE: $COMMIT_SUBJECT"
else
    # Generate from scratch
    TYPE="fix"
    if echo "$USE_COMMITS" | grep -qi "^feat"; then
        TYPE="feat"
    elif echo "$USE_COMMITS" | grep -qi "^refactor"; then
        TYPE="refactor"
    elif echo "$USE_COMMITS" | grep -qi "^docs"; then
        TYPE="docs"
    elif echo "$USE_COMMITS" | grep -qi "^chore"; then
        TYPE="chore"
    fi
    
    # Extract scope from files
    SCOPE=$(echo "$FILE_LIST" | head -1 | sed 's|.*/||' | sed 's|\..*||')
    if [[ -n "$SCOPE" ]]; then
        PR_TITLE="$TYPE($SCOPE): $FIRST_COMMIT_MSG"
    else
        PR_TITLE="$TYPE: $FIRST_COMMIT_MSG"
    fi
fi

# Fallback if still empty
if [[ -z "$PR_TITLE" ]]; then
    PR_TITLE="Update $BRANCH_NAME"
fi

echo "  Title: $PR_TITLE"

# =============================================================================
# Step 10: Generate PR Description
# =============================================================================
echo -e "${BLUE}[10/12] Generating PR description...${NC}"

# Generate description
PR_BODY="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
## Why

$(echo "$USE_COMMITS" | head -1 | sed 's/^[a-f0-9]* //')

## What

- Changes in $CHANGED_FILES file(s)
$(
echo "$FILE_LIST" | while read -r file; do
    echo "- \`$file\`"
done
)

## Highlights

$PR_HIGHLIGHTS

## Risks

$PR_RISKS

---
*Generated by automated PR creation script*"

echo "  Description generated"

# =============================================================================
# Step 11: Create PR
# =============================================================================
echo -e "${BLUE}[11/12] Creating pull request...${NC}"

# Determine gh command based on fork/upstream
if [[ "$IS_FORK" == "true" ]]; then
    echo "  Creating PR from fork ($FORK_OWNER) to upstream ($UPSTREAM_OWNER)"
    
    PR_URL=$(gh pr create \
        --repo "$UPSTREAM_OWNER/$REPO_NAME" \
        --head "$FORK_OWNER:$BRANCH_NAME" \
        --base "$TARGET_BRANCH" \
        --title "$PR_TITLE" \
        --body "$PR_BODY" 2>&1)
else
    echo "  Creating PR to $TARGET_BRANCH"
    
    PR_URL=$(gh pr create \
        --base "$TARGET_BRANCH" \
        --title "$PR_TITLE" \
        --body "$PR_BODY" 2>&1)
fi

# =============================================================================
# Step 12: Return PR URL
# =============================================================================
echo -e "${BLUE}[12/12] Returning PR URL...${NC}"

if [[ "$PR_URL" == "http"* ]]; then
    echo -e "${GREEN}✓ Pull request created successfully!${NC}"
    echo ""
    echo "PR URL: $PR_URL"
else
    echo -e "${RED}Failed to create PR: $PR_URL${NC}"
    exit 1
fi

# Output just the URL for capture
echo ""
echo "RESULT: $PR_URL"