import os
import numpy as np
import pandas as pd
from pylab import plt, mpl

from util import Timer
import market
import tradingbot
import backtest_ca as tbbrm


def clean_btc_csv(csv):
    df = pd.read_csv(csv)
    print(df.columns)

    # # 밀리초(ms) 단위 타임스탬프를 datetime으로 변환
    df["dt"] = pd.to_datetime(df["timestamp"], unit="ms")
    colums = ["dt", "open", "high", "low", "close", "volume"]
    df = df[colums]
    df.set_index("dt", inplace=True)
    df.to_csv(csv)


if __name__ == "__main__":
    btc_csvs = {
        "1h": "rl_samples/btc_usdt_1h_cache.csv",
        "1m": "rl_samples/btc_usdt_1m_cache.csv",
    }

    symbol = "close"
    # 이것도 Market 클래스 내부의 로직과 하드코딩으로 연결되어 있어서, 바꾸려면 같이 수정해야 함...
    features = [symbol, "r", "s", "m", "v"]

    # 우선 1시간 봉으로 해보자...
    # csv = btc_csvs["1m"]
    csv = btc_csvs["1h"]
    # episodes = 60
    episodes = 6
    # model_path = "rl_samples/models/btc_1m"
    model_path = "rl_samples/models/btc_1h"

    # 비율은 a는 시작 절대비율, b는 a와 더했을 때 비율, c는 추가할 절대 비율로...
    a = 0.0
    b = 0.8
    c = 0.1

    # 각 환경들 따로 만들고
    learn_env = market.Market(
        csv,
        symbol,
        features,
        window=20,
        # 시간 쉬프트를 3칸밖에 안 했던가...
        lags=3,
        leverage=1,
        min_performance=0.9,
        min_accuracy=0.475,
        start=a,
        end=a + b,
        mu=None,
        std=None,
    )
    # env = learn_env
    # print("환경 초기화", env.reset())
    # a = env.action_space.sample()
    # print("행위 선택", a)
    # print("행위 결과", env.step(a))
    valid_env = market.Market(
        csv,
        symbol,
        features=learn_env.features,
        window=learn_env.window,
        lags=learn_env.lags,
        leverage=learn_env.leverage,
        min_performance=0.0,
        min_accuracy=0.0,
        start=a + b,
        end=a + b + c,
        mu=learn_env.mu,
        std=learn_env.std,
    )
    test_env = market.Market(
        csv,
        symbol,
        features=learn_env.features,
        window=learn_env.window,
        lags=learn_env.lags,
        leverage=learn_env.leverage,
        min_performance=0.0,
        min_accuracy=0.0,
        start=a + b + c,
        end=None,
        mu=learn_env.mu,
        std=learn_env.std,
    )
    # print("훈련 환경 정보")
    # print(learn_env.data.tail())
    # print("검증 환경 정보")
    # print(valid_env.data.head())
    # print(valid_env.data.tail())
    # print("시험 환경 정보")
    # print(test_env.data.head())

    # ATR을 봐서 손익절에 활용한다면?
    data = pd.DataFrame(learn_env.data[symbol])
    print(data.head())

    # 이 지표들은 14일 기준으로 계산...
    window = 14
    # 결국 ATR 계산인거 같은데...
    data["min"] = data[symbol].rolling(window).min()
    data["max"] = data[symbol].rolling(window).max()
    data["mami"] = data["max"] - data["min"]
    # 이동 최대/최소와 전날 가격차 절대값이라..
    data["mac"] = abs(data["max"] - data[symbol].shift(1))
    data["mic"] = abs(data["min"] - data[symbol].shift(1))
    # 이동 최대 최소 차이, 최대와 전날 가격 차이, 최소와 전날 가격 차이 중 제일 큰게 ATR
    data["atr"] = np.maximum(data["mami"], data["mac"])
    data["atr"] = np.maximum(data["atr"], data["mic"])
    # ATR%는 가격대비 ATR
    data["atr%"] = data["atr"] / data[symbol]

    # 이 값으로 손절 수준을 정한다고...
    print("ATR 절대값과 상대값\n", data[["atr", "atr%"]].tail())
    leverage = 10
    print(
        "레버리지 10배에서 ATR 절대값과 상대값\n",
        data[["atr", "atr%"]].tail() * leverage,
    )
    print("레버리지 10배에서 중앙값\n", data[["atr", "atr%"]].median() * leverage)
    atr = 0.003

    # 모델은 그냥 사용해도 되지 않을까 싶은데...
    tradingbot.set_seeds(100)
    # 근데 잘 나가다 안좋아진다면 학습률 0.001을 어떻게 해야 하지 않을까?
    agent = tradingbot.TradingBot(
        24, 0.001, learn_env, valid_env, load_model=True, model_path=model_path
    )
    # 일단은 에피소드 등 하이퍼파라미터도 다 그대로 두고...
    # 에피소드를 늘려가며 보니 아무래도 널뛰는 것 같다...학습률 등으로 수렴하게 만드는 것이 관건일 듯...
    # 1분봉에서는 300번 정도 넘어가니 날뛰지는 않는거 같은데...최종이 2일간 -8% 정도로 나쁘다...
    with Timer():
        agent.learn(episodes)

    # 백테스터도 그냥 써도 되지 않을까 싶은데...
    # tb = tbbrm.TBBacktesterRM(test_env, agent.model, 10000, 0.0, 0, verbose=False)
    tb = tbbrm.TBBacktesterRM(test_env, agent.model, 10000, 0.0005, 0.0, verbose=False)

    # print("초기 자산", tb.initial_amount)
    # bar = 100
    # print("100번째 날짜와 가격", tb.get_date_price(bar))
    # print("100번째 봉의 환경 상태\n", tb.env.get_state(bar))
    # print("5000 USDT 100번째 봉에서 매수해보기")
    # tb.place_buy_order(bar, amount=5000)
    # print("200번째 봉에서의 평가 자산")
    # tb.print_net_wealth(2 * bar)
    # print("200번째 봉에서 매도해보기")
    # tb.place_sell_order(2 * bar, units=1000)
    # print("300번째 봉에서 모든 포지션 종료")
    # tb.close_out(3 * bar)

    # 이건 기본 전략 백테스팅
    print("기본 전략 백테스팅")
    tb.backtest_strategy(sl=None, tsl=None, tp=None, wait=5)

    # # 일단 기본 전략에서 그림 좀 보자..
    ax = tb.net_wealths.plot(figsize=(10, 6))
    plt.show()

    # 이거 할 때 ATR 봐야 된다는데...
    # 손절만 추가한 백테스팅 - 종가 손절
    print("손절만 추가한 백테스팅 - 종가 손절")
    tb.backtest_strategy(sl=atr, tsl=None, tp=None, wait=5, guarantee=False)
    # 손절만 추가한 백테스팅 - 손절가 손절
    print("손절만 추가한 백테스팅 - 손절가 손절")
    tb.backtest_strategy(sl=atr, tsl=None, tp=None, wait=5, guarantee=True)
    # 추적 손절만 추가한 백테스팅
    print("추적 손절만 추가한 백테스팅")
    tb.backtest_strategy(sl=None, tsl=atr, tp=None, wait=5)
    # 익절만 추가한 백테스팅 - 종가 익절
    print("익절만 추가한 백테스팅 - 종가 익절")
    tb.backtest_strategy(sl=None, tsl=None, tp=atr, wait=5, guarantee=False)
    # 익절만 추가한 백테스팅 - 익절가 익절
    print("익절만 추가한 백테스팅 - 익절가 익절")
    tb.backtest_strategy(sl=None, tsl=None, tp=atr, wait=5, guarantee=True)
    # 손절과 익절 추가한 백테스팅
    print("손절과 익절 추가한 백테스팅 - 종가 손익절")
    tb.backtest_strategy(sl=atr, tsl=None, tp=atr, wait=5, guarantee=False)
    print("손절과 익절 추가한 백테스팅 - 설정가 손익절")
    tb.backtest_strategy(sl=atr, tsl=None, tp=atr, wait=5, guarantee=True)
    # 추적 손절과 익절 추가한 백테스팅
    print("추적 손절과 익절 추가한 백테스팅")
    tb.backtest_strategy(sl=None, tsl=atr, tp=atr, wait=5)
