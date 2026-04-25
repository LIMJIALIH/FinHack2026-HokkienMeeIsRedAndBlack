# TNG Guardian Voice — KYC & Auth Update Documentation

## Overview
Updated authentication flow with two-stage KYC verification, improved admin/user role separation, and local face detection fallback for Alibaba Cloud eKYC service.

---

## Key Changes

### 1. Backend Updates (`main.py`)

#### New Dependencies
```python
import cv2  # OpenCV for face detection
import numpy as np  # NumPy for image processing
```

Dependencies added to `pyproject.toml`:
- `opencv-python>=4.8.0`
- `numpy>=1.24.0`

#### New Face Detection Functions

**`_detect_face_local(image_data: bytes) -> dict`**
- Local face detection using OpenCV Haar Cascade classifier
- Input: image bytes from file upload or webcam capture
- Output: Dictionary with detection results
- Returns confidence score and face position information
- Graceful fallback if OpenCV not available

**`/kyc/verify-face` (POST)**
- New endpoint for local face detection
- Accepts uploaded image file
- Requires authentication (Bearer token)
- Returns success/failure status with confidence score
- Updates user `kyc_status` to "verified" if successful

#### Enhanced KYC Flow
- Original Alibaba Cloud verification still available
- Local face detection as fallback option
- Backend logs all verification attempts
- KYC status tracking: `in_progress` → `verified` or `failed`

---

### 2. Frontend Updates

#### Top Navigation (`components/guardian/top-nav.tsx`)
- **Dashboard only visible in admin view**: Regulatory dashboard hidden from non-admin users
- **No sign-in button in admin mode**: Only shown when in user view
- **Smart role switching**: When "Switch to User" clicked, redirects to login if not authenticated
- **Clean separation of concerns**: Admin and user interfaces clearly separated

#### Sign-up Page (`app/signup/page.tsx`)
- **Dual verification methods**: 
  - Alibaba Cloud FACE_LIVENESS_PRO (enterprise)
  - Local face detection (fallback)
- **WebRTC camera access**: Uses browser camera via `navigator.mediaDevices.getUserMedia()`
- **Canvas capture**: Captures image from webcam for processing
- **Progress indicator**: Visual feedback during verification
- **Error handling**: Clear error messages if verification fails

#### New KYC Complete Page (`app/kyc-complete/page.tsx`)
- Handles Alibaba Cloud callback redirect
- Extracts certifyId and transactionId from URL parameters
- Completes KYC verification with backend
- Redirects to dashboard on success
- Shows error message if verification fails

---

## User Flows

### Signup & KYC Verification

```
1. User navigates to /signup
2. Enters account information (name, email, phone, IC, password, language)
3. Clicks "Continue to ID Verification"
   ↓
4. Selects verification method:
   - Option A: Alibaba Cloud → Opens hosted verification page
   - Option B: Local Face Detection → Captures webcam, sends to backend
5. Face detected and verified
6. Redirected to dashboard

DynamoDB User Record Created:
{
  user_id: "uuid4",
  full_name: "string",
  gmail: "string (lowercase)",
  phone_hash: "SHA256 hash",
  ic_hash: "SHA256 hash",
  preferred_language: "en|ms|zh|ta",
  password_hash: "argon2",
  kyc_status: "verified",
  kyc_certify_id: "string",
  kyc_transaction_id: "string",
  kyc_verified_at: "ISO8601",
  created_at: "ISO8601"
}
```

### Admin View (Default)
```
1. User starts on homepage (/), sees "Admin View"
2. Can switch between:
   - Customer Wallet (view only)
   - Regulatory Dashboard (metrics, fraud detection)
3. No sign-in/sign-out button visible
4. Can switch to "User View"
```

### User View (After Login)
```
1. User clicks "Switch to User"
2. If not authenticated → redirected to /login
3. If authenticated → shows Customer Wallet
4. Sign-in/Sign-out button visible in top right
5. Can switch back to Admin View
```

### User Login
```
1. User navigates to /login
2. Enters email and password
3. Backend validates credentials
4. If kyc_status != "verified" → redirected to /signup for KYC
5. If kyc_status == "verified" → redirected to dashboard
```

---

## Environment Variables

### Alibaba Cloud Settings (optional - can use local face detection instead)
```env
ALIBABA_CLOUD_ACCESS_KEY_ID=your_access_key
ALIBABA_CLOUD_ACCESS_KEY_SECRET=your_secret
ALIBABA_CLOUD_REGION=ap-southeast-3
ALIBABA_CLOUD_ENDPOINT=
ALIBABA_CLOUD_API_VERSION=
ALIBABA_CLOUD_PRODUCT_CODE=FACE_LIVENESS_PRO
ALIBABA_CALLBACK_URL=
ALIBABA_CLOUD_FALLBACK_ON_DENIED=true
```

### Backend URLs
```env
JWT_SECRET_KEY=your-secret-key-here
JWT_EXPIRE_DAYS=7
FRONTEND_URL=http://localhost:3000
AWS_REGION=ap-southeast-1
DYNAMO_TABLE=tng_guardian_users
```

---

## DynamoDB User Table Schema

### Primary Key
- **user_id** (String, Partition Key) — UUID v4

### Attributes
| Field | Type | Description |
|-------|------|-------------|
| full_name | String | User's full name |
| gmail | String | Email address |
| phone_hash | String | SHA256 hash of phone number |
| ic_hash | String | SHA256 hash of IC/passport |
| preferred_language | String | User's language preference |
| password_hash | String | Argon2 hashed password |
| kyc_status | String | "in_progress", "verified", "failed" |
| kyc_certify_id | String | Alibaba/local verification ID |
| kyc_transaction_id | String | Alibaba transaction ID (optional) |
| kyc_verified_at | String | ISO8601 timestamp of verification |
| created_at | String | ISO8601 timestamp of account creation |

### Global Secondary Index
- **gmail-index**: Query users by email address

---

## API Endpoints

### Authentication
- `POST /auth/signup` — Create new account + initiate KYC
- `POST /auth/login` — Login with email/password
- `GET /auth/me` — Get current user info (requires auth)

### KYC Verification
- `POST /kyc/complete` — Complete Alibaba Cloud verification
- `POST /kyc/verify-face` — Local face detection verification
- `POST /kyc/callback` — Alibaba Cloud server-side callback receiver

### Health Check
- `GET /health` — Service status + configuration info

---

## Face Detection Details

### Local Face Detection (OpenCV)
- Uses Haar Cascade classifier (`haarcascade_frontalface_default.xml`)
- Requires face to be at least 5% of image area
- Works with JPEG, PNG image formats
- Fast processing (< 500ms typical)
- No internet required

### Alibaba Cloud FACE_LIVENESS_PRO
- Enterprise-grade liveness detection
- Requires valid API credentials
- Redirects to hosted verification page
- Supports document capture
- Can verify with IC/passport

### Fallback Logic
```python
if alibaba_credentials_configured:
    try:
        use alibaba cloud
    except forbidden_access_error:
        if fallback_enabled:
            use local face detection
else:
    use local face detection (web form)
```

---

## Testing the Flow

### Local Development

1. **Backend Setup**
   ```bash
   cd backend
   uv pip install opencv-python numpy
   uv run uvicorn main:app --reload --port 8000
   ```

2. **Frontend Setup**
   ```bash
   cd frontend
   pnpm install
   pnpm dev
   ```

3. **Test Signup**
   - Navigate to http://localhost:3000/signup
   - Fill in form (use test values)
   - Select "Local Face Detection"
   - Allow camera access
   - Face should be detected automatically

4. **Test Login**
   - Navigate to http://localhost:3000/login
   - Use credentials from step 3
   - Should redirect to dashboard

5. **Test Admin/User Switch**
   - In top nav, click "Switch to User"
   - Should redirect to login if not authenticated
   - Sign in and navigate
   - Both views should work

---

## Troubleshooting

### Face Detection Not Working
1. Check OpenCV is installed: `python -c "import cv2; print(cv2.__version__)"`
2. Ensure webcam/camera permissions granted in browser
3. Make sure face is well-lit and clearly visible
4. Check console logs for detailed errors

### Alibaba Cloud Verification Failing
- Check API credentials in `.env`
- Verify region endpoint is accessible
- Check if account has sufficient quota
- Look at API response in logs: `/health` endpoint shows status

### DynamoDB Connection Issues
- Verify AWS credentials configured
- Check table exists: `tng_guardian_users`
- Ensure table has correct schema with `gmail-index`
- Check region matches `AWS_REGION` env var

---

## Security Considerations

1. **Password Hashing**: Uses Argon2 (OWASP recommended)
2. **Sensitive Field Hashing**: Phone and IC number hashed with SHA256
3. **JWT Expiration**: Default 7 days, configurable
4. **CORS**: Whitelisted origins only
5. **HTTPS**: Required in production
6. **Face Data**: Not stored after verification

---

## Next Steps (Optional Enhancements)

1. Add liveness detection (blink detection, head movement)
2. Use MediaPipe for better face detection
3. Add document OCR for IC reading
4. Implement biometric matching with stored face embedding
5. Add rate limiting for signup attempts
6. Implement 2FA for sensitive operations
7. Add audit logging for all KYC attempts

---

## File Changes Summary

### Backend
- `main.py`: Added face detection functions, new endpoints
- `pyproject.toml`: Added opencv-python, numpy dependencies

### Frontend
- `components/guardian/top-nav.tsx`: Updated for admin/user separation
- `app/signup/page.tsx`: Added face detection UI and webcam integration
- `app/kyc-complete/page.tsx`: New KYC callback handler
- `app/kyc-callback/page.tsx`: Already existed, used by Alibaba Cloud

---

## Support

For issues or questions about the KYC flow:
1. Check logs in terminal/console
2. Verify all environment variables set correctly
3. Test individual endpoints with curl or Postman
4. Check DynamoDB table structure matches schema above
