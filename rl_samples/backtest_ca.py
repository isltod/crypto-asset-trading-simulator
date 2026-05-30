# Y. Hilpisch의 EUR= 백테스팅 관련 클래스들을 BTC에 맞게 수정
import numpy as np
import pandas as pd


class BacktestingBase:
    def __init__(self, env, model, amount, ptc, ftc, verbose=False):
        self.env = env
        self.model = model
        # 이건 주문 금액
        self.initial_amount = amount
        self.current_balance = amount
        self.ptc = ptc
        self.ftc = ftc
        self.verbose = verbose
        # 이게 보유 수량...
        self.units = 0
        self.trades = 0

    # 몇 번째 봉인지 받아서, 날짜와 가격을 반환..
    def get_date_price(self, bar):
        # 날짜 까지만 추리는데...이건 시간이나 분봉으로 하려면 다 써야 할텐데...
        date = str(self.env.data.index[bar])
        # 가격은 iloc 인덱스로 찾으니 상관없고...
        price = self.env.data[self.env.symbol].iloc[bar]
        return date, price

    # 현재 잔고를 출력...
    def print_balance(self, bar):
        date, _ = self.get_date_price(bar)
        print(f"{date} | current balance = {self.current_balance:.2f}")

    # 잔고 + 보유수량 * 가격
    def calculate_net_wealth(self, price):
        return self.current_balance + self.units * price

    # 몇 번째 봉인지 받아서 평가 총 자산 출력
    def print_net_wealth(self, bar):
        date, price = self.get_date_price(bar)
        net_wealth = self.calculate_net_wealth(price)
        print(f"{date} | net wealth = {net_wealth:.2f}")

    # 매수 주문이겠지...몇 번째 봉인지 받아서...
    def place_buy_order(self, bar, amount=None, units=None):
        date, price = self.get_date_price(bar)
        # amount는 총 금액? 수량 또는 총금액 중 하나는 있어야겠고...아무튼 수량을 만들어서...
        if units is None:
            # BTC는 가격이 너무 비싸서 소숫점 보유 수량이 가능해야 한다...
            units = amount / price
        # ptc와 ftc는 뭐냐? 현재 잔고에서 빼고
        self.current_balance -= (1 + self.ptc) * units * price + self.ftc
        # 보유 수량은 늘리고
        self.units += units
        # 이건 거래 횟수인가...
        self.trades += 1
        if self.verbose:
            print(f"{date} | buy {units} units for {price:.4f}")
            self.print_balance(bar)

    # 이건 매도겠지....
    def place_sell_order(self, bar, amount=None, units=None):
        date, price = self.get_date_price(bar)
        if units is None:
            units = amount / price
        self.current_balance += (1 - self.ptc) * units * price - self.ftc
        self.units -= units
        # 거래 횟수를 팔 때도 기록하네...선물 방식인듯...
        self.trades += 1
        if self.verbose:
            print(f"{date} | sell {units} units for {price:.4f}")
            self.print_balance(bar)

    # 모든 포지션 종료하는 모양...
    def close_out(self, bar):
        date, _ = self.get_date_price(bar)
        print(50 * "=")
        print(f"{date} | *** CLOSING OUT ***")
        # 보유 수량이 음수가 되는걸 보니 선물 방식인듯...
        if self.units < 0:
            self.place_buy_order(bar, units=-self.units)
        else:
            self.place_sell_order(bar, units=self.units)
        # 잉? verbose여야 출력해야 맞는거 아닌가?
        if not self.verbose:
            print(f"{date} | current balance = {self.current_balance:.2f}")
        # 순 수익률
        perf = (self.current_balance / self.initial_amount - 1) * 100
        print(f"{date} | net performance [%] = {perf:.4f}")
        print(f"{date} | number of trades [#] = {self.trades}")
        print(50 * "=")


class TBBacktester(BacktestingBase):
    def _reshape(self, state):
        # 상태 벡터를 (배치, 쉬프트 수, 컬럼 수) 벡터로 변환...
        return np.reshape(state, [1, self.env.lags, self.env.n_features])

    def backtest_strategy(self):
        # 일단 속성들을 초기화하고...
        self.units = 0
        self.position = 0
        self.trades = 0
        self.current_balance = self.initial_amount
        self.net_wealths = list()

        # 쉬프트 시간만큼은 평가할 수 없으니, 첫 번째 봉은 쉬프트 수
        bar1st = self.env.lags

        # 거래 시작 알리고
        date1st, _ = self.get_date_price(bar1st)
        print(50 * "=")
        print(f"{date1st} | *** START BACKTEST ***")
        self.print_balance(bar1st)
        print(50 * "=")

        # 쉬프트 수 이후부터 데이터 있는 동안 반복해서...
        for bar in range(bar1st, len(self.env.data)):
            # 날짜와 가격 받고
            date, price = self.get_date_price(bar)
            # 해당 봉 이전의 쉬프트 수 만큼의 가격 등 정보 받고,
            state = self.env.get_state(bar)
            # 모델에서 행동 예측 받아서
            action = np.argmax(self.model.predict(self._reshape(state.values))[0, 0])
            # 예측 포지션을 행동에 따라 정의하고
            position = 1 if action == 1 else -1
            # 현재 보유 포지션과 예측 포지션이 다르면 거래...
            if self.position in [0, -1] and position == 1:
                # 이건 롱 예측 경우인데...
                if self.verbose:
                    print(50 * "-")
                    print(f"{date} | *** GOING LONG ***")
                # 현재 포지션이 숏이었으면, 다 팔고
                if self.position == -1:
                    self.place_buy_order(bar - 1, units=-self.units)
                # 현재 잔고 올인해서 롱 진입...
                self.place_buy_order(bar - 1, amount=self.current_balance)
                if self.verbose:
                    self.print_net_wealth(bar)
                # 현재 포지션 업데이트...
                self.position = 1
            elif self.position in [0, 1] and position == -1:
                if self.verbose:
                    print(50 * "-")
                    print(f"{date} | *** GOING SHORT ***")
                if self.position == 1:
                    self.place_sell_order(bar - 1, units=self.units)
                self.place_sell_order(bar - 1, amount=self.current_balance)
                if self.verbose:
                    self.print_net_wealth(bar)
                self.position = -1
            # 잔고 변화를 기록...
            self.net_wealths.append((date, self.calculate_net_wealth(price)))
        # 잔고 변화를 데이터프레임으로 만들어서 저장...
        self.net_wealths = pd.DataFrame(
            self.net_wealths, columns=["date", "net_wealth"]
        )
        self.net_wealths.set_index("date", inplace=True)
        self.net_wealths.index = pd.DatetimeIndex(self.net_wealths.index)
        # 남아있는 포지션 있으면 다 정리...
        self.close_out(bar)


class BacktestingBaseRM(BacktestingBase):

    def set_prices(self, price):
        # 진입 가격, 진입 후 최저와 최대 가격 기록...
        self.entry_price = price
        self.min_price = price
        self.max_price = price

    def place_buy_order(self, bar, amount=None, units=None, gprice=None):
        # 매수 주문인데, 원래 클래스와 다른건 gprice와 진입 가격 기록...
        date, price = self.get_date_price(bar)
        # 이게 뭐냐?
        if gprice is not None:
            price = gprice
        if units is None:
            # 여기도 암호화폐는 소숫점 보유량이 가능해야 한다...
            units = amount / price
        self.current_balance -= (1 + self.ptc) * units * price + self.ftc
        self.units += units
        self.trades += 1
        # 진입 가격 기록...
        self.set_prices(price)
        if self.verbose:
            print(f"{date} | buy {units} units for {price:.4f}")
            self.print_balance(bar)

    def place_sell_order(self, bar, amount=None, units=None, gprice=None):
        # 매도 주문, 원래와 다른건 gprice와 진입 가격 기록...
        date, price = self.get_date_price(bar)
        if gprice is not None:
            price = gprice
        if units is None:
            units = amount / price
        self.current_balance += (1 - self.ptc) * units * price - self.ftc
        self.units -= units
        self.trades += 1
        self.set_prices(price)
        if self.verbose:
            print(f"{date} | sell {units} units for {price:.4f}")
            self.print_balance(bar)


class TBBacktesterRM(BacktestingBaseRM):
    def _reshape(self, state):
        # 모델에 넣기 위해서 배치 차원 추가하는 함수일거고...
        return np.reshape(state, [1, self.env.lags, self.env.n_features])

    def backtest_strategy(self, sl=None, tsl=None, tp=None, wait=5, guarantee=False):
        # TBBacktester 클래스에 손절, 추적 손절, 익절 기능이 추가된 함수라고...
        self.units = 0
        self.position = 0
        self.trades = 0
        # 이게 손절 관련 변수인 듯...
        self.sl = sl
        self.tsl = tsl
        # 손/익절 발생하면 wait만큼 쉬었다가 거래...
        self.wait = 0
        self.tp = tp
        self.current_balance = self.initial_amount
        self.net_wealths = list()

        # 거래 시작 알리고
        if self.verbose:
            # 쉬프트 시간만큼은 평가할 수 없으니, 첫 번째 봉은 쉬프트 수
            bar1st = self.env.lags
            date1st, _ = self.get_date_price(bar1st)
            print(50 * "=")
            print(f"{date1st} | *** START BACKTEST ***")
            self.print_balance(bar1st)
            print(50 * "=")

        # 쉬프트 수 이후부터 데이터 있는 동안 반복해서...
        for bar in range(self.env.lags, len(self.env.data)):
            # wait는 봉마다 1씩 차감하지만 최소는 0...
            self.wait = max(0, self.wait - 1)
            # 날짜와 가격 받고
            date, price = self.get_date_price(bar)

            # 손절 주문 - 조건은 sl 설정 있어야 하고, 포지션도 있어야 하고...
            if sl is not None and self.position != 0:
                # 수익률이...
                rc = (price - self.entry_price) / self.entry_price
                # 롱 포지션의 경우는 sl 설정보다 아래면...
                if self.position == 1 and rc < -self.sl:
                    if self.verbose:
                        print(50 * "-")
                    # 손절을 정해진 값에 할 수 있다면
                    if guarantee:
                        # 정해진 값에 손절...
                        price = self.entry_price * (1 - self.sl)
                        if self.verbose:
                            print(f"*** STOP LOSS (LONG  | {-self.sl:.4f}) ***")
                    else:
                        # 아니라면 그냥 현재 가격에 손절
                        if self.verbose:
                            print(f"*** STOP LOSS (LONG  | {rc:.4f}) ***")
                    self.place_sell_order(bar, units=self.units, gprice=price)
                    # 손/익절 발생하면 wait를 설정값만큼 줘서 거래를 중지시킨다...
                    self.wait = wait
                    self.position = 0
                # 반대로 숏 포지션은 sl 설정보다 위일 경우 손절
                elif self.position == -1 and rc > self.sl:
                    if self.verbose:
                        print(50 * "-")
                    # 이것도 guarantee 조건이면 sl 설정 가격에 손절하고, 아니면 현재가에 손절...
                    if guarantee:
                        price = self.entry_price * (1 + self.sl)
                        if self.verbose:
                            print(f"*** STOP LOSS (SHORT | -{self.sl:.4f}) ***")
                    else:
                        if self.verbose:
                            print(f"*** STOP LOSS (SHORT | -{rc:.4f}) ***")
                    self.place_buy_order(bar, units=-self.units, gprice=price)
                    self.wait = wait
                    self.position = 0

            # 추적 손절 - 조건은 tsl 설정 있고 포지션도 있어야 하고
            if tsl is not None and self.position != 0:
                # 최대/최소 가격 갱신하고...이거 대비 추적 손절하는 모양...
                self.max_price = max(self.max_price, price)
                self.min_price = min(self.min_price, price)
                # 롱 포지션 손절 추적 - 최대 가격 대비 떨어진 가격
                rc_1 = (price - self.max_price) / self.entry_price
                # 숏 포지션 손절 추적 - 최소 가격 대비 올라간 가격
                rc_2 = (self.min_price - price) / self.entry_price
                # 현재 가격이 최대 가격 대비 tsl 설정 이상 떨어졌으면 롱 손절
                if self.position == 1 and rc_1 < -self.tsl:
                    if self.verbose:
                        print(50 * "-")
                        print(f"*** TRAILING SL (LONG  | {rc_1:.4f}) ***")
                    self.place_sell_order(bar, units=self.units)
                    self.wait = wait
                    self.position = 0
                # 반대로 최소 가격 대비 tsl 설정보다 올랐으면 숏 포지션 손절
                elif self.position == -1 and rc_2 < -self.tsl:
                    if self.verbose:
                        print(50 * "-")
                        print(f"*** TRAILING SL (SHORT | {rc_2:.4f}) ***")
                    self.place_buy_order(bar, units=-self.units)
                    self.wait = wait
                    self.position = 0

            # 익절 - tp 설정 있어야 하고 포지션도 있어야 하고...
            if tp is not None and self.position != 0:
                rc = (price - self.entry_price) / self.entry_price
                # 이건 롱 포지션은 tp 설정보다 더 올라갔으면 익절
                if self.position == 1 and rc > self.tp:
                    if self.verbose:
                        print(50 * "-")
                    if guarantee:
                        price = self.entry_price * (1 + self.tp)
                        if self.verbose:
                            print(f"*** TAKE PROFIT (LONG  | {self.tp:.4f}) ***")
                    else:
                        if self.verbose:
                            print(f"*** TAKE PROFIT (LONG  | {rc:.4f}) ***")
                    self.place_sell_order(bar, units=self.units, gprice=price)
                    self.wait = wait
                    self.position = 0
                # 숏 포지션은 -tp보다 더 내려갔으면 익절
                elif self.position == -1 and rc < -self.tp:
                    if self.verbose:
                        print(50 * "-")
                    if guarantee:
                        price = self.entry_price * (1 - self.tp)
                        if self.verbose:
                            print(f"*** TAKE PROFIT (SHORT | {self.tp:.4f}) ***")
                    else:
                        if self.verbose:
                            print(f"*** TAKE PROFIT (SHORT | {-rc:.4f}) ***")
                    self.place_buy_order(bar, units=-self.units, gprice=price)
                    self.wait = wait
                    self.position = 0

            # 여기부터 정상 거래 상황이고...
            # 해당 봉 이전의 쉬프트 수 만큼의 가격 등 정보 받고,
            state = self.env.get_state(bar)
            # 모델에서 행동 예측 받아서 포지션 정하고
            action = np.argmax(self.model.predict(self._reshape(state.values))[0, 0])
            position = 1 if action == 1 else -1
            # 현재 보유 포지션과 예측 포지션이 다르면 거래...
            # 위에서 손/익절 했으면 wait 설정때문에 바로는 진입하지 않는다...
            if self.position in [0, -1] and position == 1 and self.wait == 0:
                # 롱 예측 경우...
                if self.verbose:
                    print(50 * "-")
                    print(f"{date} | *** GOING LONG ***")
                # 현재 포지션이 숏이었으면, 다 팔고
                if self.position == -1:
                    self.place_buy_order(bar - 1, units=-self.units)
                # 현재 잔고 올인해서 롱 진입...
                self.place_buy_order(bar - 1, amount=self.current_balance)
                if self.verbose:
                    self.print_net_wealth(bar)
                # 현재 포지션 업데이트...
                self.position = 1
            elif self.position in [0, 1] and position == -1 and self.wait == 0:
                if self.verbose:
                    print(50 * "-")
                    print(f"{date} | *** GOING SHORT ***")
                if self.position == 1:
                    self.place_sell_order(bar - 1, units=self.units)
                self.place_sell_order(bar - 1, amount=self.current_balance)
                if self.verbose:
                    self.print_net_wealth(bar)
                self.position = -1
            # 잔고 변화 평가 잔고이므로 거래 없어도 매번 기록...
            self.net_wealths.append((date, self.calculate_net_wealth(price)))
        # 잔고 변화를 데이터프레임으로 만들어서 저장...
        self.net_wealths = pd.DataFrame(
            self.net_wealths, columns=["date", "net_wealth"]
        )
        self.net_wealths.set_index("date", inplace=True)
        self.net_wealths.index = pd.DatetimeIndex(self.net_wealths.index)
        # 남아있는 포지션 있으면 다 정리...
        self.close_out(bar)
