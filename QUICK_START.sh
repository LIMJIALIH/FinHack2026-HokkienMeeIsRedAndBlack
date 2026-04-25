#!/usr/bin/env bash
# Quick Start Guide — Testing KYC & Auth Updates
# Run these commands to set up and test the new features

set -e

echo "🚀 TNG Guardian Voice — Quick Start"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Install dependencies
echo -e "${BLUE}Step 1: Installing backend dependencies...${NC}"
cd backend
uv pip install opencv-python numpy
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 2: Start backend
echo -e "${BLUE}Step 2: Starting backend server...${NC}"
echo "Backend will start on http://localhost:8000"
echo "Press Ctrl+C to stop when ready"
echo "Opening in new terminal..."
echo ""

# Note: In real usage, this would start in a separate terminal
# For quick reference, we just show the command
echo -e "${YELLOW}Run this in a terminal:${NC}"
echo "  cd backend && uv run uvicorn main:app --reload --port 8000"
echo ""

# Step 3: Start frontend
echo -e "${BLUE}Step 3: Starting frontend server...${NC}"
echo "Frontend will start on http://localhost:3000"
echo ""

echo -e "${YELLOW}Run this in another terminal:${NC}"
echo "  cd frontend && pnpm dev"
echo ""

# Step 4: Testing checklist
echo -e "${BLUE}Step 4: Testing checklist${NC}"
echo ""
echo "Before you test, make sure to:"
echo "  1. ✓ Backend running on port 8000"
echo "  2. ✓ Frontend running on port 3000"
echo "  3. ✓ .env file configured with AWS credentials (if using DynamoDB)"
echo ""

# API endpoints to test
echo -e "${BLUE}Available API Endpoints:${NC}"
echo ""
echo "Health Check:"
echo "  GET http://localhost:8000/health"
echo ""
echo "Sign Up (with KYC):"
echo "  POST http://localhost:8000/auth/signup"
echo "  Body: {\"full_name\": \"John Doe\", \"gmail\": \"john@example.com\", "
echo "         \"phone\": \"+60123456789\", \"ic_number\": \"901231-14-5678\", "
echo "         \"preferred_language\": \"en\", \"password\": \"SecurePass123\"}"
echo ""
echo "Face Detection (Local):"
echo "  POST http://localhost:8000/kyc/verify-face"
echo "  Content-Type: multipart/form-data (image file)"
echo "  Header: Authorization: Bearer <token>"
echo ""
echo "Complete KYC:"
echo "  POST http://localhost:8000/kyc/complete"
echo "  Body: {\"certify_id\": \"<certify_id>\", \"transaction_id\": \"<tx_id>\"}"
echo "  Header: Authorization: Bearer <token>"
echo ""

# User flows
echo -e "${BLUE}Test Scenarios:${NC}"
echo ""

echo "Scenario 1: Sign Up with Local Face Detection"
echo "  └─ Go to http://localhost:3000/signup"
echo "  └─ Fill in form with test data"
echo "  └─ Click 'Local Face Detection'"
echo "  └─ Allow camera permission"
echo "  └─ Ensure face is visible (good lighting)"
echo "  └─ Should complete in ~3 seconds"
echo "  └─ Redirect to dashboard"
echo ""

echo "Scenario 2: Sign Up with Alibaba Cloud"
echo "  └─ Go to http://localhost:3000/signup"
echo "  └─ Fill in form with test data"
echo "  └─ Click 'Alibaba Cloud Verification'"
echo "  └─ (Only if credentials configured) → Redirect to Alibaba"
echo "  └─ (If simulation mode) → Auto-complete after animation"
echo ""

echo "Scenario 3: Admin View Testing"
echo "  └─ Default route / shows admin view"
echo "  └─ Can switch between 'Customer Wallet' and 'Regulatory Dashboard'"
echo "  └─ No sign-in button visible"
echo "  └─ Click 'Switch to User' → Redirect to /login"
echo ""

echo "Scenario 4: User View Testing"
echo "  └─ Click 'Switch to User' after signing in"
echo "  └─ Shows 'Customer Wallet' only (no dashboard)"
echo "  └─ Sign-in/out button visible in top right"
echo "  └─ Click 'Switch to Admin' → Shows both views"
echo ""

echo "Scenario 5: Login Flow"
echo "  └─ Go to http://localhost:3000/login"
echo "  └─ Enter email from signup"
echo "  └─ Enter password from signup"
echo "  └─ Should redirect to dashboard"
echo ""

# Debugging tips
echo -e "${BLUE}Debugging Tips:${NC}"
echo ""
echo "1. Check backend logs for errors:"
echo "   └─ Look for 'HAS_OPENCV: True' in logs"
echo ""
echo "2. Check if DynamoDB is configured:"
echo "   └─ http://localhost:8000/health"
echo "   └─ Should show simulation modes"
echo ""
echo "3. Browser console for frontend errors:"
echo "   └─ F12 → Console tab"
echo "   └─ Check for CORS errors or API issues"
echo ""
echo "4. Face detection not working:"
echo "   └─ Check browser camera permissions"
echo "   └─ Ensure face is well-lit and visible"
echo "   └─ Try positioning face closer to camera"
echo ""

# Commands reference
echo -e "${BLUE}Quick Commands Reference:${NC}"
echo ""
echo "# Check OpenCV installation"
echo "  python -c \"import cv2; print(cv2.__version__)\""
echo ""
echo "# View backend logs"
echo "  cd backend && uv run uvicorn main:app --reload"
echo ""
echo "# View frontend logs"
echo "  cd frontend && pnpm dev"
echo ""
echo "# Run tests (if available)"
echo "  cd backend && uv run pytest"
echo ""

# Next steps
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo "1. Read CHANGES_SUMMARY.md for overview"
echo "2. Read KYC_AUTH_UPDATE.md for full documentation"
echo "3. Follow the scenarios above to test all flows"
echo "4. Check DynamoDB for user records after signup"
echo "5. Test with different images for face detection"
echo ""

echo -e "${GREEN}✓ Setup complete! Ready to test.${NC}"
echo ""
