---
name: business_card_processor
description: Extract contact information from business card images using OCR, automatically create Google Contacts entries with intelligent categorization, and create email drafts for review. Use when: (1) processing business card photos to digitize contact info, (2) automating networking follow-ups from NEFBA or other events, (3) categorizing contacts by profession with interactive prompts, (4) creating email drafts for review before sending.
---

# Business Card Processor

Automate the complete business card workflow: OCR extraction → Google Contacts with categorization → email draft creation. Perfect for networking events like NEFBA meetings where you collect multiple business cards and want professional, categorized follow-up.

## Quick Start

**One-time setup** (terminal required):
1. `python scripts/setup.py` - Install dependencies and configure Google APIs

**Daily use** (through OpenClaw):
1. Send business card photo to OpenClaw
2. Specify event name (optional): "This is from the NEFBA March meeting"
3. Contact automatically created with profile photo + follow-up email sent

No terminal needed for routine processing!

## Core Workflow

### Step 1: Image to Contact Data
- **Input**: Business card photo (JPG, PNG, etc.)
- **Process**: OCR extraction using EasyOCR (local processing, no API calls)
- **Output**: Structured contact information (name, email, phone, company, title, website)

### Step 2: Google Contacts Integration with Intelligent Categorization
- **Process**: Authenticate with Google APIs, create contact entry
- **Profile Photos**: Automatically searches LinkedIn and company websites for profile images
- **Auto-Labeling**: Always adds "_nefba" label to contacts from networking events
- **Smart Categorization**: Uses existing contact labels to categorize by profession:
  - Structural Engineers (Residential/Commercial) 
  - General Contractors (Residential/Commercial)
  - MEP Engineers, Civil Engineers, Architects, etc.
- **Interactive Prompts**: When category is ambiguous, prompts for user selection
- **Output**: Google Contact with proper categorization, labels, and profile photo

### Step 3: Email Draft Creation (Not Automatic Sending)
- **Process**: Creates Gmail draft instead of sending immediately 
- **Template**: Professional networking follow-up with event context
- **Review**: Allows you to review and edit before sending
- **Customization**: Event name, company mentions, personalized greeting

## Usage Options

**Through OpenClaw** (recommended for daily use):
- Send business card photo: "Process this business card"  
- With event context: "Process this card from the NEFBA March meeting"
- **Interactive flow**: If category is ambiguous, Howard will prompt:
  - "This appears to be a structural engineer. Residential (1) or Commercial (2)?"
  - Reply with: "1", "2", "residential", "commercial", or "skip"
- Profile photos and categorization automatically handled

**Direct Command Line** (for testing/advanced use):
```bash
# Basic processing with photo search
python scripts/process_business_card.py image.jpg

# Specify event context
python scripts/process_business_card.py image.jpg --event "NEFBA February Meeting"

# Skip profile photo search
python scripts/process_business_card.py image.jpg --no-photo

# Skip follow-up email
python scripts/process_business_card.py image.jpg --no-email

# Parse only (test mode)
python scripts/process_business_card.py image.jpg --dry-run
```

## Setup Requirements

**First-time setup**: Run `scripts/setup.py` to install dependencies and configure Google API access.

**Google API Requirements**:
- Google Cloud project with People API and Gmail API enabled
- OAuth credentials downloaded as `credentials.json` 
- First-run authentication flow (browser-based consent)

See `references/api-setup.md` for complete setup instructions.

## Intelligence Features

### OCR Parsing
- **Names**: First substantial text without numbers/symbols
- **Titles**: Matches keywords (VP, Director, Manager, etc.)
- **Companies**: ALL CAPS text or business suffixes (Inc, LLC, Corp)
- **Emails**: Standard email format validation
- **Phones**: Multiple format support with intelligent formatting
- **Websites**: Auto-adds HTTPS protocol if missing

### Profile Photo Search
- **LinkedIn Integration**: Searches for professional profile photos
- **Company Website**: Checks team/about pages for headshots
- **Face Recognition**: Helps with name recall - you remember faces better than names
- **Automatic Integration**: Photos embedded directly in Google Contacts

## Email Templates

**NEFBA Follow-up Template** (default):
```
Subject: Great meeting you at {event_name}

Hi {name},

It was great meeting you at the {event_name}. I enjoyed our conversation and would love to stay connected.

{company_mention}

Looking forward to keeping in touch!

Best regards,
Rob Zinn
ZINN Architecture
zinn.ai
```

Templates automatically customize based on extracted contact information and specified event context.

## Batch Processing

For multiple business cards, create a simple loop:
```bash
for card in *.jpg; do
    python scripts/process_business_card.py "$card" --event "NEFBA March 2024"
done
```

## Resources

### scripts/
- **process_business_card.py**: Main processing script with complete workflow
- **setup.py**: One-time installation and Google API configuration

### references/  
- **api-setup.md**: Complete Google API setup guide and troubleshooting
- **examples.md**: Usage examples, OCR patterns, and expected outputs
