# ZINN_TRELLO_CARD_DATA_SCHEMA.md - Using Trello like a database

## Concept

Use Trello like a database.

## Structure

Trello provides a human-readable and editable display of information that is organized in the followin  hierarchy:

- boards
- lists
- cards

## Descriptions as data

This schema uses card descriptions to store data in Markdown format like values in a data table.

Cards are divided into sections delimited by a h2 and horizontal lines like...

---\n\n##data_label\n\ndata_value\n\n

## Direct edit by humans

- Humans can easily work with and modify data using Trello's WYSIWYG description formatting to create structured markdown without coding knowledge
- Humans may accidentally deviate from the delimiting format so data structure checks and cleanup should be built-into description reads