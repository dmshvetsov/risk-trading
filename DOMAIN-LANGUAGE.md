Skew -  skewness measures the asymmetry in a frequency distribution, broadly means to distort, twist, or cause something to be asymmetrical, biased, or not straight.

Oracle SVI "a" parameter - The base volatility level. Higher a lifts the whole curve up. "a" moves the smile up/down.

Oracle SVI "b" parameter - The steepness of the curve. Higher b means volatility changes more aggressively as strike moves away from the center. "b" makes the smile sharper/flatter.

Oracle SVI "rho" parameter - The tilt / skew. It decides whether the curve leans more toward lower strikes or higher strikes. "rho" tilts the smile left/right.

Oracle SVI "m" parameter - The center point of the curve. It shifts the volatility “smile” left or right. "m" moves the center left/right.

Oracle SVI "sigma" parameter - The smoothness / width around the center. Higher sigma makes the middle of the curve wider and smoother. sigma controls how rounded the middle is.

Oracle SVI "k" parameter - mathematical version of moneyness `k = ln(strike / forward)`

Oracle "spot" price - current price of the assets know by Oracle, assume it lagging behind the real market price.

Oracle "forward" price - expected price by Oracle at time of expiry of the option.

Option "moneyness" - tells the model how far the contract is from ATM (at-the-money), ITM (in-the-moeny), OTM (out-the-money)

In-the-money (ITM) - positive option moneyness, when asset spot price is above option strike price

Out-the-money (OTM) - negative option moneyness, when asset spot price is below option strike price

Stochastic Volatility Inspired (SVI) - parametric model used to smooth and model implied volatility smiles and surfaces. 

Volatility smile - is the pattern where options with different strikes have different implied volatility. I.e. BTC at 50k high implied volatility, 60k lower implied volatility, 70k high implied volatility while spot price is around 60k. Markets usually price extreme moves as more risky than a simple like standard deviation based model would suggest because far-away outcomes are not as impossible as basic math says.
