use alloy::primitives::{Address, TxHash, U256};
use alloy::sol;
use anyhow::{Context, Result};
use async_trait::async_trait;

sol! {
    #[sol(rpc)]
    contract IERC20 {
        function approve(address spender, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
    }

    #[sol(rpc)]
    contract IWithdrawalQueue {
        struct WithdrawalQueueMetadata {
            uint256 queued;
            uint256 claimable;
            uint256 claimed;
            uint256 nextWithdrawalIndex;
        }

        function fundWithdrawals(uint256 amount, address source) external returns (uint256 claimable);
        function queueMetadata() external view returns (WithdrawalQueueMetadata memory);
    }
}

#[async_trait]
pub trait CustodianSigner: Send + Sync {
    async fn approve_usdc(&self, spender: Address, amount: U256) -> Result<TxHash>;
    async fn fund_withdrawals(&self, amount: U256, source: Address) -> Result<TxHash>;
    async fn usdc_balance_of(&self, account: Address) -> Result<U256>;
    async fn current_claimable(&self) -> Result<U256>;
}

pub struct LocalCustodianSigner<T, P> {
    usdc: IERC20::IERC20Instance<T, P>,
    wq: IWithdrawalQueue::IWithdrawalQueueInstance<T, P>,
}

impl<T, P> LocalCustodianSigner<T, P>
where
    T: alloy::transports::Transport + Clone,
    P: alloy::providers::Provider<T>,
{
    pub fn new(
        usdc: IERC20::IERC20Instance<T, P>,
        wq: IWithdrawalQueue::IWithdrawalQueueInstance<T, P>,
    ) -> Self {
        Self { usdc, wq }
    }
}

#[async_trait]
impl<T, P> CustodianSigner for LocalCustodianSigner<T, P>
where
    T: alloy::transports::Transport + Clone + Send + Sync,
    P: alloy::providers::Provider<T> + Send + Sync,
{
    async fn approve_usdc(&self, spender: Address, amount: U256) -> Result<TxHash> {
        let tx_hash = self
            .usdc
            .approve(spender, amount)
            .send()
            .await
            .context("approve tx send failed")?
            .watch()
            .await
            .context("approve tx confirmation failed")?;
        Ok(tx_hash)
    }

    async fn fund_withdrawals(&self, amount: U256, source: Address) -> Result<TxHash> {
        let tx_hash = self
            .wq
            .fundWithdrawals(amount, source)
            .send()
            .await
            .context("fundWithdrawals tx send failed")?
            .watch()
            .await
            .context("fundWithdrawals tx confirmation failed")?;
        Ok(tx_hash)
    }

    async fn usdc_balance_of(&self, account: Address) -> Result<U256> {
        let balance = self
            .usdc
            .balanceOf(account)
            .call()
            .await
            .context("balanceOf call failed")?;
        Ok(balance._0)
    }

    async fn current_claimable(&self) -> Result<U256> {
        let metadata = self
            .wq
            .queueMetadata()
            .call()
            .await
            .context("queueMetadata call failed")?;
        Ok(metadata._0.claimable)
    }
}
