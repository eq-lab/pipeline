use alloy::primitives::U256;
use alloy::sol;
use anyhow::{Context, Result};

sol! {
    #[sol(rpc)]
    contract IERC20 {
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

        function queueMetadata() external view returns (WithdrawalQueueMetadata memory);
    }
}

pub struct OnChainReader<T, P> {
    usdc: IERC20::IERC20Instance<T, P>,
    wq: IWithdrawalQueue::IWithdrawalQueueInstance<T, P>,
}

impl<T, P> OnChainReader<T, P>
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

    pub async fn usdc_balance_of(&self, account: alloy::primitives::Address) -> Result<U256> {
        let balance = self
            .usdc
            .balanceOf(account)
            .call()
            .await
            .context("balanceOf call failed")?;
        Ok(balance._0)
    }

    pub async fn current_claimable(&self) -> Result<U256> {
        let metadata = self
            .wq
            .queueMetadata()
            .call()
            .await
            .context("queueMetadata call failed")?;
        Ok(metadata._0.claimable)
    }
}
