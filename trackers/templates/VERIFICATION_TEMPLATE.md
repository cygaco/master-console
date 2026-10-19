<!-- VERIFICATION RECORD TEMPLATE (Verification Matrix). Use one row per item in the
     Verification Matrix of ../../TRACKER.md, or one block per item in an epic/sprint verification log.
     Proves existence, nonexistence, state, and wiring of everything the system references. Assumptions
     are NOT verification. Replace every <angle-bracket> placeholder.

     Allowed states:
       Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired |
       Exists But Stale | Exists But Incomplete | Exists But Miswired |
       Missing But Required | Present But Should Be Removed | Unknown
     (Unknown is allowed only temporarily; it is a validation failure / blocker if it affects completion.) -->

## Matrix row form (paste into the Verification Matrix table)

| Item | Mentioned? | Required? | Should exist? | Does it exist? | Where | Current? | Wired? | Wired where | Wiring verified how | Proof (cmd/inspection) | Evidence | Checked | By | Unknown remaining |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| <ITEM> | <Yes/No> | <Yes/No> | <Yes/No> | <Yes/No/Verified Nonexistent> | <PATH or n/a> | <Yes/No/n/a> | <Yes/No/n/a> | <WIRING SITE or n/a> | <METHOD> | <COMMAND OR FILE CHECK> | <LINK/OUTPUT> | <YYYY-MM-DD> | <AGENT> | <WHAT'S UNKNOWN or None> |

## Detailed block form (for a single item)

### Verification: <ITEM NAME>

- **Is it mentioned?** <Yes/No — where>
- **Is it required?** <Yes/No>
- **Should it exist?** <Yes/No>
- **Does it exist?** <Yes/No>
- **If it exists, where is it?** <PATH or n/a>
- **If it should not exist, was nonexistence verified?** <Yes/No/n/a>
- **If it exists, is it current?** <Yes/No/n/a>
- **If it exists, is it wired?** <Yes/No/n/a>
- **If wired, where is it wired?** <FILE / CONFIG SITE or n/a>
- **How was wiring verified?** <METHOD or n/a>
- **What command, inspection, or file check proved the state?** <EXACT CHECK>
- **What evidence supports the claim?** <LINK / OUTPUT EXCERPT>
- **When was it checked?** <YYYY-MM-DD HH:MM TZ>
- **Who checked it?** <AGENT>
- **What remains unknown?** <UNKNOWNS or None>
- **Verification state:** <Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown>
