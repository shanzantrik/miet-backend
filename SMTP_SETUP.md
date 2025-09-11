# SMTP Email Configuration Guide

## Overview

This guide helps you configure SMTP email notifications for the MIET application using Nodemailer.

## Environment Variables

Add these to your `.env` file in the backend directory:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

## Gmail Setup (Recommended)

### Step 1: Enable 2-Factor Authentication

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable 2-Factor Authentication if not already enabled

### Step 2: Generate App Password

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Click "App passwords" under "2-Step Verification"
3. Select "Mail" and "Other (custom name)"
4. Enter "MIET Backend" as the name
5. Copy the generated 16-character password

### Step 3: Configure Environment Variables

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-character-app-password
```

## Other SMTP Providers

### Outlook/Hotmail

```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
```

### Yahoo Mail

```env
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=587
SMTP_USER=your-email@yahoo.com
SMTP_PASS=your-app-password
```

### Custom SMTP Server

```env
SMTP_HOST=your-smtp-server.com
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASS=your-password
```

## Testing Email Configuration

1. Restart the backend server after setting environment variables
2. Look for this message in the console:

   - ✅ "SMTP server is ready to send emails"
   - ❌ "SMTP configuration error: [error message]"

3. Try creating a webinar or consultation to test email notifications

## Troubleshooting

### Common Issues:

1. **"Authentication failed"**: Check your email and app password
2. **"Connection refused"**: Verify SMTP host and port
3. **"Less secure app access"**: Use app passwords instead of regular passwords

### Gmail Specific:

- Use App Passwords, not your regular Gmail password
- Make sure 2-Factor Authentication is enabled
- Check that "Less secure app access" is disabled (use App Passwords instead)

## Security Notes

- Never commit SMTP credentials to version control
- Use environment variables for all sensitive data
- Consider using a dedicated email service for production (SendGrid, Mailgun, etc.)
