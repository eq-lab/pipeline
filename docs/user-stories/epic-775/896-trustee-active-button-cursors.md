# Issue #896 — Trustee active buttons show pointer cursor

## Story

As a Trustee using the dashboard, I need enabled buttons to show the pointer cursor on hover so actionable controls are visually distinct from disabled or inert controls.

## Test Cases

### Enabled route buttons show pointer cursor

1. Open a Trustee dashboard page that renders an enabled native button, such as an Origination review action or loan lifecycle action.
2. Hover the enabled button.
3. Confirm the cursor changes to a pointer.

### Disabled buttons remain non-actionable

1. Open a Trustee dashboard state where a button is disabled or waiting for an in-flight action.
2. Hover the disabled button.
3. Confirm the cursor remains non-actionable, such as `not-allowed`, and the button cannot be clicked.
