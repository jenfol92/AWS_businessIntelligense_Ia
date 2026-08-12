import { spApiRequest } from "./spApiClient";
import { paginateFinances } from "./financesPagination.mjs";

const FINANCES_V0 = "/finances/v0";
const FINANCES_2024 = "/finances/2024-06-19";

export type AmazonMoney = { CurrencyCode?: string; CurrencyAmount?: number };

export type FinancialEventGroup = {
  FinancialEventGroupId: string;
  ProcessingStatus: string;
  FundTransferStatus?: string;
  OriginalTotal?: AmazonMoney;
  ConvertedTotal?: AmazonMoney;
  FundTransferDate?: string;
  TraceId?: string;
  BeginningBalance?: AmazonMoney;
  FinancialEventGroupStart?: string;
  FinancialEventGroupEnd?: string;
};

export type FinancesTransaction = Record<string, unknown>;
export type FinancesTransactionStatus = "DEFERRED" | "DEFERRED_RELEASED" | "RELEASED";

type Request = typeof spApiRequest;

export function createFinancesClient(request: Request = spApiRequest) {
  return {
    async listFinancialEventGroups(input: {
      startedAfter: string;
      startedBefore?: string;
      maxResultsPerPage?: number;
    }): Promise<FinancialEventGroup[]> {
      return paginateFinances(async (nextToken?: string) => request<{
          payload?: { FinancialEventGroupList?: FinancialEventGroup[]; NextToken?: string };
        }>({
          method: "GET",
          path: `${FINANCES_V0}/financialEventGroups`,
          query: nextToken
            ? { NextToken: nextToken }
            : {
                FinancialEventGroupStartedAfter: input.startedAfter,
                FinancialEventGroupStartedBefore: input.startedBefore,
                MaxResultsPerPage: String(input.maxResultsPerPage ?? 100),
              },
        }), response => response.payload?.FinancialEventGroupList ?? [], response => response.payload?.NextToken);
    },

    async listTransactions(input: {
      financialEventGroupId?: string;
      transactionStatus?: FinancesTransactionStatus;
      postedAfter?: string;
      postedBefore?: string;
    }): Promise<FinancesTransaction[]> {
      return paginateFinances(async (nextToken?: string) => request<{
          payload?: {
            transactions?: FinancesTransaction[];
            nextToken?: string;
          };
        }>({
          method: "GET",
          path: `${FINANCES_2024}/transactions`,
          query: {
            ...(nextToken ? { nextToken } : {}),
            relatedIdentifierName: input.financialEventGroupId ? "FINANCIAL_EVENT_GROUP_ID" : undefined,
            relatedIdentifierValue: input.financialEventGroupId,
            transactionStatus: input.transactionStatus ?? "RELEASED",
            postedAfter: input.postedAfter,
            postedBefore: input.postedBefore,
          },
        }), response => response.payload?.transactions ?? [], response => response.payload?.nextToken);
    },
  };
}

export const { listFinancialEventGroups, listTransactions } = createFinancesClient();
