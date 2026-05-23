# USER.md - About Your Human


## Trello Card Format

Cards are divided into sections delimited by a hl and h2 elements like...

---\n\n## Fee\n\n???\n\n

Certain list entry events require that a card has complete or valid section content. When a card fails validation, it should be returned to the sending list before any other actions are attempted, with a validation failure email being sent to the member who changed the card list.

A mature card has all of the following fields with valid data:

# General Notes
# Project Address
# Client
- fullname(s): can be multiple (csv)
- company or affiliation with "attention: " prefix (optional)
- address: single line
- email: can be multiple (csv order matches fullnames)
# Budget
# Scope
# Fee
- can be multiline
- format: [description] ("optional", or custom note): $0,000
# Area
# Phases (any or all)
- Pre Design
- Schematic Design
- Design Development
- Construction Documents
- Construction Administration
- Additional Services
- Furnishings and Decor
# Billing Type (one selected)
- Fixed fee
- Hourly no budget
- Hourly NTE
# Proposal Length
- long
- medium
- short

---
---

# example structure

markdown format...

---

## status

 [schedule](card_schedule.html?card_id=z7MPz3ze&board_id=5f84a9ea3e629c7eb4b2be27&auth=z)


## General

- VIP\repeat client
- hold!
- ignore!

---

## Project Address

8272 Riding Club Rd, Jacksonville, FL 32256

---

## Client

Bill Spinner
8272 Riding Club Rd, Jacksonville, FL 32256
[Bill@jaxgreenindustrial.com](mailto:Bill@jaxgreenindustrial.com "‌")
(904) 757-5331, (904) 757-5312

---

## Area

450 sf

---

## Budget

$157,500

---

## Scope

Develop permit/construction drawings for a new guest addition at the above-noted Project Address.

The addition will consist of a mother-in-law suite including a bedroom, bathroom, and closet connected to the main residence via a breezeway. The structure will function as both a guest bedroom and art studio, with the bathroom also serving as a pool bath with exterior access.

The following design goals and parameters have been established:

- Hip roof to match the existing residence with matching gutters and downspouts.
- Brick veneer exterior to match the existing home style.
- Vaulted ceilings throughout the addition.
- Consider a Dormer on the west facade for added natural light.
- Spacious bathroom with typical residential ADA clearances.
- Operable windows; preserve existing windows at main house.
- Mini-split HVAC system.
- Conventional framing with exterior walls at 2x6 at 12 or 16 inches on center.
- Provide opening sizes for all windows and doors.
- Builders set — space plan showing location of structure, height, width, and entry.

The Base Fee is based on 9% of the estimated cost of construction ($350/sf × 450 sf = $157,500). Because Bill is an experienced builder who will manage Fixtures and Finishes selection and construction administration independently, the Design Development and Construction Administration phases have been removed from the project and fee noted below.

---

## Fee

• Base Fee (9% of CC): $14,175
• Pre Design Credit (10%): -$1,418
• Design Development Credit (30%): -$4,253
• Construction Administration Credit (5%): -$709
• VIP/Repeat Client Credit (5%): -$709

---

## Phases

- Schematic Design
- Construction Documents

---

## Proposal Length

- long

---

## Billing Type

- Fixed fee

---

---

## Fee Line Format

```
Description: $1,234.00                          → required line
Description (optional): $1,234.00               → optional checkbox
Description (Credit): -$1,000.00                → credit (shows in red)
Description: $1,000, $2,000, $3,000             → tiered radio (basic/standard/premium)