# HMG-SEC-001: Critical Security Vulnerability - Missing Path Traversal Tests

**Title**: Implement unit tests for validateManifestPath function to prevent directory traversal attacks  
**Description**: The validateManifestPath function in apps/web/app/api/architecture/modify/route.ts lacks unit tests for path traversal prevention. This creates a critical security vulnerability where malicious inputs like "../../etc/passwd" could bypass validation.  
**Priority**: Highest  
**Component**: Security  
**Steps to Reproduce**:

1. Attempt to call POST /api/architecture/modify with manifestPath set to "../../etc/passwd"
2. Observe that validation may not properly block the request  
   **Expected Behavior**: Function should throw error for any path outside .architecture directory  
   **Actual Behavior**: Missing test coverage leaves vulnerability undetected  
   **Fix**: Add comprehensive unit tests covering:

- Valid paths within .architecture directory
- Path traversal attempts (../, ../../, etc.)
- Absolute paths
- Symlink scenarios
- Various edge cases (null, empty string, etc.)

**Status**: In Progress
