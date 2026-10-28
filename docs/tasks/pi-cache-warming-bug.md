# Report the pi cache warming bug upstream and drop the Nixos#382 patch

Pi keeps the prompt cache warm only while message objects stay the same. Custom messages, context edits and compaction summaries get new objects, so warming stops. A local patch fixes it. Report the bug upstream and remove the patch when pi has the fix.

## Source

- zerodawn-pi main: TODO.md

## Original text

- Pi bug: `sdk.js` keeps cache warming only while each message object stays the same, and `buildSessionProjection` builds new objects for custom messages, context edits and compaction summaries. Nixos#382 patches it. Report it upstream; remove the patch when pi fixes it.
