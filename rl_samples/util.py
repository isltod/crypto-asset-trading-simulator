from pylab import plt, mpl
import numpy as np
import os
import pandas as pd
import time

# 이 설정들은 한 군데서 하면 될거 같은데...모듈들 죄다 하고 있네...
plt.style.use("seaborn-v0_8")
mpl.rcParams["savefig.dpi"] = 300
mpl.rcParams["font.family"] = "serif"
pd.set_option("mode.chained_assignment", None)
pd.set_option("display.float_format", "{:.4f}".format)
np.set_printoptions(suppress=True, precision=4)
os.environ["PYTHONHASHSEED"] = "0"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "5"


class Timer:
    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *args):
        print(f"소요 시간: {time.perf_counter() - self.start:.5f}초")
