<!-- README for NPM; the one for GitHub is in .github directory. (https://stackoverflow.com/questions/41297117/how-to-specify-different-readme-files-for-github-and-npm) -->
# Usage

Install the package
Read the [Whitepaper](https://github.com/DistributedCollective/sovryn-perpetual-swap/blob/main/docs/SovrynPerpetualsV1_1.9.pdf).

```
$ npm install --save @sovryn/perpetual-swap
```

Then in your script: 

`import { perpQueries, perpUtils } from "@sovryn/perpetual-swap";`


And to use the functions from, let's say, `scripts/utils/perpQueries.ts`:

`const { queryTraderState, queryAMMState, queryPerpParameters } = perpQueries;`



The same works for the rest of the files:

`const { getMarkPrice } = perpUtils;`

* See [here the docs for the functions exported by `perpUtils`](../dev/scripts/utils/perpUtils.md).
* See [here the docs for the functions exported by `perpQueries`](../dev/scripts/utils/perpQueries.md).
* See [here the docs for the functions exported by `perpMath`](../dev/scripts/utils/perpMath.md).
* See [here the docs for the functions exported by `walletUtils`](../dev/scripts/utils/walletUtils.md).

## Observation
In order to use `walletUtils` (only works on the backend. It doesn't work in UI because it needs to read the ABIs from disk) you'll have to import it like this:

`import * as walletUtils from '@sovryn/perpetual-swap/dist/scripts/utils/walletUtils';`