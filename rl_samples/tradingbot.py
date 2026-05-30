#
# Financial Q-Learning Agent (PyTorch Version)
#
# (c) Dr. Yves J. Hilpisch
# Artificial Intelligence in Finance
# Modified for PyTorch and ONNX export capability
#
import os
import random
import logging
import numpy as np
from pylab import plt, mpl
from collections import deque
import torch
import torch.nn as nn
import torch.optim as optim

os.environ["PYTHONHASHSEED"] = "0"
plt.style.use("seaborn-v0_8")
mpl.rcParams["savefig.dpi"] = 300
mpl.rcParams["font.family"] = "serif"


def set_seeds(seed=100):
    # 난수 생성 시드 고정
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


class PyTorchQNetwork(nn.Module):
    def __init__(self, input_dim, hidden_dim, output_dim=2, dropout=False):
        super(PyTorchQNetwork, self).__init__()
        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.dropout1 = nn.Dropout(0.3) if dropout else None
        self.fc2 = nn.Linear(hidden_dim, hidden_dim)
        self.dropout2 = nn.Dropout(0.3) if dropout else None
        self.fc3 = nn.Linear(hidden_dim, output_dim)

    def forward(self, x):
        # x shape: (batch_size, lags, input_dim)
        out = torch.relu(self.fc1(x))
        if self.dropout1 is not None:
            out = self.dropout1(out)
        out = torch.relu(self.fc2(out))
        if self.dropout2 is not None:
            out = self.dropout2(out)
        out = self.fc3(out)
        # out shape: (batch_size, lags, output_dim)
        return out

    def predict(self, state):
        self.eval()
        with torch.no_grad():
            state_tensor = torch.tensor(state, dtype=torch.float32)
            out = self(state_tensor)
            return out.cpu().numpy()


class TradingBot:
    def __init__(
        self,
        hidden_units,
        learning_rate,
        learn_env,
        valid_env=None,
        val=True,
        dropout=False,
        load_model=False,
        model_path="data/rl_model",
    ):
        self.learn_env = learn_env
        self.valid_env = valid_env
        self.val = val
        self.epsilon = 1.0
        self.epsilon_min = 0.1
        self.epsilon_decay = 0.99
        self.learning_rate = learning_rate
        self.gamma = 0.5
        self.batch_size = 128
        self.max_treward = 0
        self.averages = list()
        self.trewards = []
        self.performances = list()
        self.aperformances = list()
        self.vperformances = list()
        self.memory = deque(maxlen=2000)
        self.model_path = model_path
        self.hidden_units = hidden_units
        self.dropout = dropout

        self.criterion = nn.MSELoss()

        if load_model:
            self.model = self._load_model()
        else:
            self.model = self._build_model(hidden_units, learning_rate, dropout)
        self.best_val_acc = 0.0

    def _build_model(self, hu, lr, dropout):
        model = PyTorchQNetwork(
            input_dim=self.learn_env.n_features,
            hidden_dim=hu,
            output_dim=2,
            dropout=dropout
        )
        self.optimizer = optim.RMSprop(model.parameters(), lr=lr)
        return model

    def _load_model(self):
        model = PyTorchQNetwork(
            input_dim=self.learn_env.n_features,
            hidden_dim=self.hidden_units,
            output_dim=2,
            dropout=self.dropout
        )
        pth_path = self.model_path + ".pth"
        if os.path.exists(pth_path):
            model.load_state_dict(torch.load(pth_path))
            print(f"Loaded PyTorch model state dict from {pth_path}")
        else:
            print(f"Warning: {pth_path} not found. Creating a new model instead.")
        self.optimizer = optim.RMSprop(model.parameters(), lr=self.learning_rate)
        return model

    def act(self, state):
        # 엡실론 비율에 따라 무작위 행동 또는 지금까지 학습된 모델 예측...
        if random.random() <= self.epsilon:
            return self.learn_env.action_space.sample()
        action = self.model.predict(state)[0, 0]
        return np.argmax(action)

    def replay(self):
        # 각 에피소드 끝에, 경험을 리플레이해서 학습... 배치를 랜덤으로 뽑아서 배치 단위로 업데이트
        batch = random.sample(self.memory, self.batch_size)
        
        states_list = []
        targets_list = []
        
        for state, action, reward, next_state, done in batch:
            # target_val shape: (1, lags, 2)
            target_val = self.model.predict(state)
            if not done:
                next_pred = self.model.predict(next_state)
                reward += self.gamma * np.amax(next_pred[0, 0])
            target_val[0, 0, action] = reward
            
            states_list.append(state[0])     # shape: (lags, n_features)
            targets_list.append(target_val[0]) # shape: (lags, 2)
            
        states_tensor = torch.tensor(np.array(states_list), dtype=torch.float32)   # shape: (batch_size, lags, n_features)
        targets_tensor = torch.tensor(np.array(targets_list), dtype=torch.float32) # shape: (batch_size, lags, 2)
        
        self.model.train()
        self.optimizer.zero_grad()
        outputs = self.model(states_tensor)
        loss = self.criterion(outputs, targets_tensor)
        loss.backward()
        self.optimizer.step()
        
        # 다음 도전 전에 엡실론은 감쇠
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay

    def learn(self, episodes):
        # 에피소드만큼 반복해서 각각 만 번 시도해서, 행동하고 상태받아서 경험으로 저장...
        for e in range(1, episodes + 1):
            state = self.learn_env.reset()
            state = np.reshape(
                state, [1, self.learn_env.lags, self.learn_env.n_features]
            )
            for _ in range(10000):
                action = self.act(state)
                next_state, reward, done, info = self.learn_env.step(action)
                next_state = np.reshape(
                    next_state, [1, self.learn_env.lags, self.learn_env.n_features]
                )
                self.memory.append([state, action, reward, next_state, done])
                state = next_state
                if done:
                    treward = _ + 1
                    self.trewards.append(treward)
                    av = sum(self.trewards[-25:]) / 25
                    perf = self.learn_env.performance
                    self.averages.append(av)
                    self.performances.append(perf)
                    self.aperformances.append(sum(self.performances[-25:]) / 25)
                    self.max_treward = max(self.max_treward, treward)
                    templ = "episode: {:2d}/{} | treward: {:4d} | "
                    templ += "perf: {:5.3f} | av: {:5.1f} | max: {:4d}"
                    print(
                        templ.format(e, episodes, treward, perf, av, self.max_treward),
                        end="\r",
                    )
                    break
            # 검증 정확도도 같은 모델에서 측정하고
            if self.val:
                self.validate(e, episodes)
            # 다음 에피소드에는 학습한 모델로 임하고...
            if len(self.memory) > self.batch_size:
                self.replay()
        print()
        self.save_model()

    def validate(self, e, episodes):
        # 검증 데이터로 정확도 측정...
        state = self.valid_env.reset()
        state = np.reshape(state, [1, self.valid_env.lags, self.valid_env.n_features])
        for _ in range(10000):
            action = np.argmax(self.model.predict(state)[0, 0])
            next_state, reward, done, info = self.valid_env.step(action)
            state = np.reshape(
                next_state, [1, self.valid_env.lags, self.valid_env.n_features]
            )
            if done:
                treward = _ + 1
                perf = self.valid_env.performance
                self.vperformances.append(perf)
                if e % int(episodes / 6) == 0:
                    templ = 71 * "="
                    templ += "\nepisode: {:2d}/{} | VALIDATION | "
                    templ += "treward: {:4d} | perf: {:5.3f} | eps: {:.2f}\n"
                    templ += 71 * "="
                    print(templ.format(e, episodes, treward, perf, self.epsilon))
                break

    def save_model(self):
        dir_name = os.path.dirname(self.model_path)
        if dir_name and not os.path.exists(dir_name):
            os.makedirs(dir_name, exist_ok=True)
            
        # PyTorch 가중치 저장
        pth_path = self.model_path + ".pth"
        torch.save(self.model.state_dict(), pth_path)
        print(f"\n[PyTorch] Saved state dict to {pth_path}")
        
        # ONNX 모델 변환 저장
        onnx_path = self.model_path + ".onnx"
        self.export_onnx(onnx_path)

        # 평균(mu) 및 표준편차(std) 설정 저장
        import json
        try:
            mu_dict = self.learn_env.mu.to_dict() if hasattr(self.learn_env.mu, "to_dict") else list(self.learn_env.mu)
            std_dict = self.learn_env.std.to_dict() if hasattr(self.learn_env.std, "to_dict") else list(self.learn_env.std)
            config = {
                "features": self.learn_env.features,
                "window": self.learn_env.window,
                "lags": self.learn_env.lags,
                "mu": mu_dict,
                "std": std_dict
            }
            config_path = self.model_path + "_config.json"
            with open(config_path, "w") as f:
                json.dump(config, f, indent=4)
            print(f"[Config] Saved model parameters to {config_path}")
        except Exception as e:
            print(f"Warning: Failed to save config JSON: {e}")

    def export_onnx(self, export_path):
        self.model.eval()
        # Input shape: (1, lags, n_features)
        dummy_input = torch.zeros(
            1, self.learn_env.lags, self.learn_env.n_features, dtype=torch.float32
        )
        torch.onnx.export(
            self.model,
            dummy_input,
            export_path,
            input_names=["input"],
            output_names=["output"],
            dynamic_axes={"input": {0: "batch_size"}, "output": {0: "batch_size"}},
            opset_version=11
        )
        print(f"[ONNX] Exported model to ONNX format at {export_path}")


def plot_treward(agent):
    # 몇 번까지 살아남았나 마지막 25개 평균과 그 회귀 그래프...
    plt.figure(figsize=(10, 6))
    x = range(1, len(agent.averages) + 1)
    y = np.polyval(np.polyfit(x, agent.averages, deg=3), x)
    plt.plot(x, agent.averages, label="moving average")
    plt.plot(x, y, "r--", label="regression")
    plt.xlabel("episodes")
    plt.ylabel("total reward")
    plt.legend()
    plt.show()


def plot_performance(agent):
    # 검증 훈련과 검증 데이터로 수익률 그래프...
    plt.figure(figsize=(10, 6))
    x = range(1, len(agent.performances) + 1)
    y = np.polyval(np.polyfit(x, agent.performances, deg=3), x)
    plt.plot(x, agent.performances[:], label="training")
    plt.plot(x, y, "r--", label="regression (train)")
    if agent.val:
        y_ = np.polyval(np.polyfit(x, agent.vperformances, deg=3), x)
        plt.plot(x, agent.vperformances[:], label="validation")
        plt.plot(x, y_, "r-.", label="regression (valid)")
    plt.xlabel("episodes")
    plt.ylabel("gross performance")
    plt.legend()
    plt.show()
