"""Self-check frozen Q4 hand arithmetic; not a simulator acceptance test."""
import json
from fractions import Fraction
from pathlib import Path


FIXTURE = (Path(__file__).resolve().parents[2] / "tests" / "fixtures" /
           "stage3-lifecycle-oracles.json")


def corpus():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def exact_int(value):
    assert value.denominator == 1, f"fixture unexpectedly needs rounding: {value}"
    return value.numerator


def spot_quote(base_units, price):
    return exact_int(Fraction(base_units * price * 10**6, 10**8))


def perp_quote(contracts, contract_base_units, price):
    return spot_quote(contracts * contract_base_units, price)


def check_dict(actual, expected):
    for key, value in expected.items():
        assert actual[key] == int(value), (key, actual[key], value)


def test_spot_oracle_balances_fees_and_marked_equity():
    scenario = corpus()["spot"]
    usdc = int(scenario["initial"]["wallet"]["USDC"])
    btc = int(scenario["initial"]["wallet"]["BTC"])
    eth = int(scenario["initial"]["wallet"]["ETH"])
    assert usdc + exact_int(Fraction(eth * 2000 * 10**6, 10**18)) == \
        int(scenario["initial"]["equityUsdcUnits"])
    basis = realized = usdc_fees = eth_fees = 0
    for index, event in enumerate(scenario["events"]):
        quantity = int(event["baseUnits"])
        quote = spot_quote(quantity, int(event["priceUsdcPerBtc"]))
        assert quote == int(event["quoteUnits"])
        fee = int(event["feeUnits"])
        if event["kind"] == "buy":
            usdc -= quote
            btc += quantity
            basis += quote
        else:
            removed_basis = exact_int(Fraction(basis * quantity, btc))
            btc -= quantity
            basis -= removed_basis
            realized += quote - removed_basis
            usdc += quote
        if event["feeAsset"] == "USDC":
            usdc -= fee
            usdc_fees += fee
        else:
            assert event["feeAsset"] == "ETH"
            eth -= fee
            eth_fees += fee
        if index == 1:
            expected = scenario["afterTwoBuys"]
            check_dict({"USDC": usdc, "BTC": btc, "ETH": eth},
                       expected["wallet"])
            assert basis == int(expected["grossBasisUsdcUnits"])
            assert usdc_fees == int(expected["quoteFeeUsdcUnits"])
            assert eth_fees == int(expected["ethFeeUnits"])
        if index in (2, 3):
            expected = scenario["afterFirstSell"] if index == 2 \
                else scenario["afterClose"]
            check_dict({"USDC": usdc, "BTC": btc, "ETH": eth},
                       expected["wallet"])
            assert realized == int(expected["realizedGrossUsdcUnits"])
            assert usdc_fees == int(expected["quoteFeesUsdcUnits"])
            assert eth_fees == 10**15
            btc_mark = 27000 if index == 2 else 26800
            gross_unrealized = spot_quote(btc, btc_mark) - basis
            if index == 2:
                assert gross_unrealized == int(
                    expected["unrealizedGrossUsdcUnitsAtBtcMark27000"])
            else:
                assert gross_unrealized == int(
                    expected["unrealizedGrossUsdcUnits"])
            eth_value = exact_int(Fraction(eth * 2000 * 10**6, 10**18))
            fee_value = exact_int(Fraction(eth_fees * 2000 * 10**6, 10**18))
            assert fee_value == int(expected["ethFeeUsdcUnitsAtFreshMark2000"])
            equity = usdc + spot_quote(btc, btc_mark) + eth_value
            equity_key = "equityUsdcUnitsAtFreshMarks" if index == 2 \
                else "equityUsdcUnitsAtFreshEthMark"
            assert equity == int(expected[equity_key])
            assert equity - int(scenario["initial"]["equityUsdcUnits"]) == \
                int(expected["adjustedGainVsInitialUsdcUnits"])
    assert scenario["missingEthMark"]["portfolioEquity"] == "unknown"


def test_linear_perp_oracle_margin_realized_unrealized_and_funding():
    scenario = corpus()["linearPerp"]
    wallet = int(scenario["initialWalletUsdcUnits"])
    collateral = contracts = basis = realized = fees = funding = margin_reserved = 0
    contract_base = int(scenario["contractBaseBtcUnits"])
    for index, event in enumerate(scenario["events"]):
        kind = event["kind"]
        if kind == "funding_debit":
            amount = int(event["fundingUsdcUnits"])
            collateral -= amount
            funding += amount
            continue
        quantity = int(event["contracts"])
        notional = perp_quote(quantity, contract_base,
                              int(event["priceUsdcPerBtc"]))
        fee = exact_int(Fraction(notional * scenario["feeBps"], 10000))
        assert notional == int(event["notionalUsdcUnits"])
        assert fee == int(event["feeUsdcUnits"])
        fees += fee
        if kind in ("open", "increase"):
            margin = exact_int(Fraction(notional *
                scenario["initialMarginBps"], 10000))
            assert margin == int(event["marginTransferUsdcUnits"])
            wallet -= margin + fee
            collateral += margin
            margin_reserved += margin
            contracts += quantity
            basis += notional
        else:
            removed_basis = exact_int(Fraction(basis * quantity, contracts))
            gain = notional - removed_basis
            assert removed_basis == int(event["basisUsdcUnits"])
            assert gain == int(event["realizedGrossUsdcUnits"])
            release = exact_int(Fraction(margin_reserved * quantity, contracts))
            assert release == int(event["marginReleaseUsdcUnits"])
            margin_reserved -= release
            basis -= removed_basis
            contracts -= quantity
            realized += gain
            if kind == "reduce":
                wallet += release - fee
                collateral += gain - release
            else:
                assert kind == "close" and contracts == 0 and margin_reserved == 0
                wallet += collateral + gain - fee
                collateral = 0
        if index == 1:
            expected = scenario["afterIncreaseAtMark26000"]
            unrealized = perp_quote(contracts, contract_base, 26000) - basis
            check_dict({"contracts": contracts, "walletUsdcUnits": wallet,
                "collateralUsdcUnits": collateral,
                "grossBasisUsdcUnits": basis,
                "unrealizedGrossUsdcUnits": unrealized,
                "equityUsdcUnits": wallet + collateral + unrealized}, expected)
        if index == 3:
            expected = scenario["afterFundingAndReduceAtMark27000"]
            unrealized = perp_quote(contracts, contract_base, 27000) - basis
            check_dict({"contracts": contracts, "walletUsdcUnits": wallet,
                "collateralUsdcUnits": collateral,
                "grossBasisRemainingUsdcUnits": basis,
                "realizedGrossUsdcUnits": realized,
                "unrealizedGrossUsdcUnits": unrealized,
                "feesUsdcUnits": fees, "fundingPaidUsdcUnits": funding,
                "equityUsdcUnits": wallet + collateral + unrealized}, expected)
    expected = scenario["afterClose"]
    check_dict({"contracts": contracts, "walletUsdcUnits": wallet,
        "collateralUsdcUnits": collateral,
        "realizedGrossUsdcUnits": realized,
        "unrealizedGrossUsdcUnits": 0, "feesUsdcUnits": fees,
        "fundingPaidUsdcUnits": funding, "equityUsdcUnits": wallet,
        "adjustedGainUsdcUnits": wallet -
            int(scenario["initialWalletUsdcUnits"])}, expected)
    assert realized - fees - funding == wallet - \
        int(scenario["initialWalletUsdcUnits"])
    assert scenario["missingOrStaleMark"]["equity"] == "unknown"


def test_external_deposit_is_not_investment_return():
    data = corpus()
    result = data["cashFlowAdjustment"]
    closed = int(data["linearPerp"]["afterClose"]["equityUsdcUnits"])
    deposit = int(result["exampleDepositUsdcUnits"])
    assert closed + deposit == int(
        result["equityAfterPerpCloseAndDepositUsdcUnits"])
    assert closed + deposit - int(data["linearPerp"][
        "initialWalletUsdcUnits"]) - deposit == int(
        result["investmentGainAfterAdjustmentUsdcUnits"])
