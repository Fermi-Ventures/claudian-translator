# Literal-use controls for the Team Vale lists

One literal use per word or phrase that the lists carry or that the reviewer
named as at risk. `vale --config vale/.vale.ini --output=line tests/insider.literal-controls.md`
must report zero `Team.Insider` hits and zero `Team.InsiderWord` hits.
Any new token that fires here is a false positive on literal use and goes
back to the phrase it was coined in. Written 29 Aug at the reviewer's worry:
"the same word can be used literally in one context and a metaphor in
another." First run, before the fix: three tokens fired.

The amnesty law of 1990 pardoned tax arrears filed before June.

Do not remove a load-bearing wall without a structural engineer's sign-off.

The sprint burn-down chart is updated each morning from the ticket ledger.

Each class in the schema module declares its fields, and every function returns a typed value.

The application starts when the container receives the ready signal.

The audit found evidence of a breach in the March logs.

The mobile app renders the order list from data returned by the orders endpoint.

The tell-tale on the mainsail shows the wind direction to the helm.

Wear an apron in the kitchen and clothes that cover the arms.

The migration is what proves the trigger was dropped.
