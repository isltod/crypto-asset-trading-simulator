# Y. Hilpisch Finance 모듈을 BTC 시장에 맞춰 변경
import math
import random
import numpy as np
import pandas as pd


# 몇 시간 단위 쉬프트해서 볼건지 저장해놓는 도움 클래스 - 사실 별 쓸모가...
class observation_space:
    def __init__(self, n):
        self.shape = (n,)


# 엡실론 비율에 따른 무작위 탐색시 무작위 행위 반환 - 이것도 사실 별 쓸모가...
class action_space:
    def __init__(self, n):
        self.n = n

    def sample(self):
        return random.randint(0, self.n - 1)


class Market:

    def __init__(
        self,
        # 하드코딩을 csv 파일명 받도록 수정
        csv,
        symbol,
        features,
        window,
        lags,
        leverage=1,
        min_performance=0.85,
        min_accuracy=0.5,
        # 훈련/검증/시험 데이터 나누기를 비율로 받도록 수정
        start=0,
        end=None,
        mu=None,
        std=None,
    ):
        self.symbol = symbol
        self.features = features
        self.n_features = len(features)
        self.window = window
        self.lags = lags
        self.leverage = leverage
        self.min_performance = min_performance
        self.min_accuracy = min_accuracy
        self.start = start
        self.end = end
        self.mu = mu
        self.std = std
        self.observation_space = observation_space(self.lags)
        self.action_space = action_space(2)
        self._get_data(csv)
        self._prepare_data()

    def _get_data(self, csv):
        # 이건 넘겨받은 csv 파일을 df로 읽기만 하고...
        self.raw = pd.read_csv(csv, index_col=0, parse_dates=True).dropna()

    def _prepare_data(self):
        # 기준 컬럼만 읽고
        self.data = pd.DataFrame(self.raw[self.symbol])
        # 훈련/검증/시험 데이터 분리 - 비율로 받도록 수정
        start_idx = int(len(self.data) * self.start)
        self.data = self.data.iloc[start_idx:]
        # 로그 수익률
        self.data["r"] = np.log(self.data / self.data.shift(1))
        self.data.dropna(inplace=True)
        # 원래 가격의 이동 평균, 로그 수익률의 이동 평균과 표준편차
        self.data["s"] = self.data[self.symbol].rolling(self.window).mean()
        self.data["m"] = self.data["r"].rolling(self.window).mean()
        self.data["v"] = self.data["r"].rolling(self.window).std()
        self.data.dropna(inplace=True)
        # 가우스 정규화
        if self.mu is None:
            self.mu = self.data.mean()
            self.std = self.data.std()
        self.data_ = (self.data - self.mu) / self.std
        # 로그 수익률의 방향을 1/0으로...이거 1/-1로 바꿔야 하지 않나?
        self.data["d"] = np.where(self.data["r"] > 0, 1, 0)
        self.data["d"] = self.data["d"].astype(int)
        # 훈련/검증/시험 데이터 분리 - 비율로 받도록 수정
        if self.end is not None:
            end_idx = int(len(self.raw) * self.end)
            self.data = self.data.iloc[: end_idx - start_idx]
            self.data_ = self.data_.iloc[: end_idx - start_idx]

    # 현재 설정된 봉 번호에 따라 특성 데이터 반환
    def _get_state(self):
        return self.data_[self.features].iloc[self.bar - self.lags : self.bar]

    # 이건 위랑 똑같은데 외부에서 봉 번호를 받아서 처리한다는 것만 다른데...
    def get_state(self, bar):
        return self.data_[self.features].iloc[bar - self.lags : bar]

    # 난수 시드 설정
    def seed(self, seed):
        random.seed(seed)
        np.random.seed(seed)

    # 환경 초기화...총보상(살아남은 횟수)와 정확도는 0, 수익률은 1, 봉 번호는 쉬프트 수로
    def reset(self):
        self.treward = 0
        self.accuracy = 0
        self.performance = 1
        self.bar = self.lags
        # 첫 번째 상태 정보 반환
        state = self.data_[self.features].iloc[self.bar - self.lags : self.bar]
        return state.values

    def step(self, action):
        # 받은 행동이 봉 번호로 찾은 로그 수익률 방향과 같으면 correct
        correct = action == self.data["d"].iloc[self.bar]
        # 현재 봉번호로 본 로그 수익률에 레버리지 곱
        ret = self.data["r"].iloc[self.bar] * self.leverage
        # 보상 1은 맞추면 1, 틀리면 0
        reward_1 = 1 if correct else 0
        # 보상 2는 맞추면 수익률, 틀리면 마이너스 수익률
        reward_2 = abs(ret) if correct else -abs(ret)
        # 총보상은 맞춘 횟수
        self.treward += reward_1
        # 봉 번호 1 증가시키고
        self.bar += 1
        # 정확도는 시작(lags)에서부터 몇 봉까지인지로 총보상을 나누면 되고...
        self.accuracy = self.treward / (self.bar - self.lags)
        # 수익률은 보상 2를 exp해서 로그 지우기로 계산...
        self.performance *= math.exp(reward_2)
        # 현재 봉 번호가 데이터 끝이면 완료
        if self.bar >= len(self.data):
            done = True
        # 보상 1이 있다면 완료 아니다? 마지막에 맞추면 완료 아닌가?
        elif reward_1 == 1:
            done = False
        # 시작 후 15번 이상 지났는데 최소 자산 밑으로 내려갔다면 끝내고...
        elif self.performance < self.min_performance and self.bar > self.lags + 15:
            done = True
        # 시작 후 15번 이상 지났는데 정확도가 최소 기준 밑으로 내려가도 끝내고...
        elif self.accuracy < self.min_accuracy and self.bar > self.lags + 15:
            done = True
        else:
            done = False
        # 다음 반복 위해서 상태 정보 읽고
        state = self._get_state()
        info = {}
        # 다음 상태값, 보상 1 + 보상 2의 5배? 완료 여부 반환...
        return state.values, reward_1 + reward_2 * 5, done, info
