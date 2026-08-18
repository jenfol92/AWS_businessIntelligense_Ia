import test from "node:test";
import assert from "node:assert/strict";
import {buildAmazonRealMtd,classifyAmazonRealMtdTransaction} from "./amazonEconomicForecastV2.ts";

const ecb={date:"2026-08-12",rates:{EUR:1,GBP:0.86,SEK:11}};
const tx=(transactionType,amount,breakdownType="ProductCharges")=>({transactionType,postedDate:"2026-08-10T10:00:00Z",totalAmount:{currencyAmount:amount,currencyCode:"EUR"},marketplaceDetails:{marketplaceId:"ES",marketplaceName:"ES"},breakdowns:[{breakdownType:"Sales",breakdownAmount:{currencyAmount:amount,currencyCode:"EUR"},breakdowns:[{breakdownType,breakdownAmount:{currencyAmount:amount,currencyCode:"EUR"},breakdowns:[{breakdownType:"Base",breakdownAmount:{currencyAmount:amount,currencyCode:"EUR"}}]}]}]});
const real=transactions=>buildAmazonRealMtd({transactions,periodStart:"2026-08-01T00:00:00Z",periodEnd:"2026-08-31T23:59:59Z",ecb});

test("1 Shipment included",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("Shipment",70)).included,true));
test("2 Refund included",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("Refund",-20)).included,true));
test("3 ProductAdsPayment included",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("ProductAdsPayment",-9,"AdvertisingFee")).included,true));
test("4 ServiceFee included",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("ServiceFee",-5,"SubscriptionFee")).included,true));
test("5 Storage included",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("ServiceFee",-5,"StorageBillingFee")).included,true));
test("6 inbound fee included",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("ServiceFee",-5,"InboundTransportationFee")).included,true));
test("7 Transfer excluded from economic MTD",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("Transfer",100,"FundTransfer")).included,false));
test("8 payout excluded",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("Disbursement",100,"FundTransfer")).economicClass,"PAYOUT_CASH_TRANSFER"));
test("9 ReserveDebit and ReserveCredit excluded",()=>{assert.equal(classifyAmazonRealMtdTransaction(tx("Adjustment",-30,"ReserveDebit")).included,false);assert.equal(classifyAmazonRealMtdTransaction(tx("Adjustment",30,"ReserveCredit")).included,false);});
test("10 FailedDisbursement is not revenue",()=>assert.equal(classifyAmazonRealMtdTransaction(tx("Adjustment",100,"FailedDisbursement")).included,false));
test("11 payout plus shipment does not double count",()=>assert.equal(real([tx("Shipment",70),tx("Transfer",70,"FundTransfer")]).marketplaces[0].nativeAmount,70));
test("12 totalAmount remains authoritative inside included transaction",()=>{const event=tx("Shipment",70);event.breakdowns[0].breakdownAmount.currencyAmount=100;assert.equal(real([event]).marketplaces[0].nativeAmount,70);});
