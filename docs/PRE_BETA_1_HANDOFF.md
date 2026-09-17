# Mapolis Pre-Beta 1 Handoff: Email & Forgotten Credentials Flow

## Goal
Complete the missing account recovery capabilities in Mapolis, specifically allowing users (parents) to recover forgotten handles or reset forgotten passwords via their registered parent email, while maintaining strict COPPA/FERPA compliance.

## Current State Analysis
Right now, the `restore-email-submit` button in `play/index.html` simply reads the email input and calls the `restore_profile_by_email` RPC. The RPC searches the `profiles` table for a matching `parent_email`, retrieves the profile data, and immediately logs the user in (mapping the profile to their current device's anonymous `auth_uid`).

**The Problem:**
This is completely insecure. Anyone who knows a parent's email address could "restore" their profile, bypassing the RLS and password protections entirely. Furthermore, there is currently no flow allowing users to reset a forgotten password.

## Functional Requirements to Implement

To secure this flow and bring it up to production standards, we need to implement a multi-step verification process using One-Time Passwords (OTPs) or Magic Links sent via email. 

### Phase 1: Database Setup & Email Integration
1.  **Verification Codes Table**: We must create a new table `recovery_codes` in Supabase to track short-lived, randomly generated OTPs.
    - Columns: `id` (uuid), `profile_id` (uuid), `code` (string, e.g. 6-digit), `expires_at` (timestamp), `used` (boolean).
    - Or alternatively, use Supabase Auth's built-in email verification if we decide to convert parent emails into actual Supabase Auth Users. However, given our architecture relies on anonymous sessions mapped to custom `profiles`, a custom OTP table is the simplest robust approach.
2.  **Email Sending Mechanism**: 
    - Supabase Edge Functions: Create a simple Edge Function `send-recovery-email` that connects to an SMTP provider (like Resend) to dispatch the recovery code.
    - Alternatively: If setting up Edge Functions is out of scope for this step, we can build a fallback "Recovery Question/PIN" mechanism. *Assuming we want real email:* we need to integrate an email service API (Resend, SendGrid, etc.).

### Phase 2: The New Recovery Flow (RPCs)
We need three new/updated Remote Procedure Calls (RPCs):
1.  `rpc/request_email_recovery(p_email)`: Looks up the email. If it exists, generates a 6-digit code, saves it to `recovery_codes`, and triggers the email dispatch. Returns a generic "If this email exists, a code has been sent" success message.
2.  `rpc/verify_email_recovery(p_email, p_code)`: Validates the code against `recovery_codes`. If valid, it generates and returns a secure, short-lived "reset token".
3.  `rpc/reset_password_with_token(p_reset_token, p_new_password_hash)`: Applies the new password hash to the profile and logs the user in (updates the `auth_uid` to the current device's session).

### Phase 3: Frontend UI State Machine (`play/index.html`)
The "Parent Email" tab in the restore overlay needs a new state machine:
- **State 1: Input Email**: User enters `parent_email`. Clicks "Send Code".
- **State 2: Input Code**: UI changes to "We sent a 6-digit code to [email]". User enters code. Clicks "Verify".
- **State 3: Reset Password**: If verified, the UI displays "Your handle is: **[Handle]**". It provides a form to input a new password and confirm the password.
- **State 4: Complete**: Password is mathematically hashed via `crypto.subtle`, sent via `reset_password_with_token`, and the user is logged into the game state.

## Security & Compliance Rules
- **No Leaking Existence**: `request_email_recovery` must ALWAYS return a generic success message, regardless of whether the email exists in the database. This prevents bad actors from "fishing" to see if a parent uses Mapolis.
- **Hash on Client**: Passwords must ALWAYS be hashed on the client-side (`crypto.subtle.digest`) *before* being sent over the network to the RPC.
- **Code Expiration**: All OTPs must expire strictly after 15 minutes.

## Next Steps for the Next Session
1. Decide on the Email Delivery Service (Resend via Edge Functions vs. another approach).
2. Write the `.sql` migration to create the `recovery_codes` table and the 3 new RPCs.
3. Update `play/index.html` to implement the 4-step UI state machine.
4. Update `shared.js` with the new fetch methods for these RPCs.
