import sys
import datetime
import ccxt
import pandas as pd
import numpy as np
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout,
                               QHBoxLayout, QLabel, QDateTimeEdit, QPushButton,
                               QTableWidget, QTableWidgetItem, QMessageBox, QHeaderView, QSplitter, QAbstractItemView, QDialog, QDoubleSpinBox, QSpinBox, QStatusBar, QProgressBar, QCheckBox, QComboBox)
from PySide6.QtCore import QDateTime, Qt, QTimer
from PySide6.QtGui import QAction

# 타임프레임별 설정 상수
TIMEFRAME_CONFIG = {
    '1m':  {'label': '1분',  'ms': 60_000,        'ccxt': '1m',  'cache': 'btc_usdt_1m_cache.csv'},
    '3m':  {'label': '3분',  'ms': 180_000,       'ccxt': '3m',  'cache': 'btc_usdt_3m_cache.csv'},
    '5m':  {'label': '5분',  'ms': 300_000,       'ccxt': '5m',  'cache': 'btc_usdt_5m_cache.csv'},
    '15m': {'label': '15분', 'ms': 900_000,       'ccxt': '15m', 'cache': 'btc_usdt_15m_cache.csv'},
    '30m': {'label': '30분', 'ms': 1_800_000,     'ccxt': '30m', 'cache': 'btc_usdt_30m_cache.csv'},
    '1h':  {'label': '1시간','ms': 3_600_000,     'ccxt': '1h',  'cache': 'btc_usdt_1h_cache.csv'},
    '4h':  {'label': '4시간','ms': 14_400_000,    'ccxt': '4h',  'cache': 'btc_usdt_4h_cache.csv'},
    '1d':  {'label': '1일',  'ms': 86_400_000,    'ccxt': '1d',  'cache': 'btc_usdt_1d_cache.csv'},
}
TIMEFRAME_KEYS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']

class DownloadDialog(QDialog):
    def __init__(self, parent=None, start_str=None, end_str=None, timeframe='1m'):
        super().__init__(parent)
        self.setWindowTitle("데이터 다운로드 설정")
        self.resize(380, 200)
        
        layout = QVBoxLayout(self)

        # Timeframe 선택
        tf_layout = QHBoxLayout()
        tf_layout.addWidget(QLabel("시간 틀 선택:"))
        self.tf_combo = QComboBox()
        for key in TIMEFRAME_KEYS:
            self.tf_combo.addItem(TIMEFRAME_CONFIG[key]['label'], key)
        # 현재 선택된 타임프레임으로 초기화
        idx = TIMEFRAME_KEYS.index(timeframe) if timeframe in TIMEFRAME_KEYS else 0
        self.tf_combo.setCurrentIndex(idx)
        tf_layout.addWidget(self.tf_combo)
        layout.addLayout(tf_layout)
        
        # Start Time
        start_layout = QHBoxLayout()
        self.start_label = QLabel("시작 날짜 & 시간:")
        if start_str:
            start_default = QDateTime.fromString(start_str, "yyyy-MM-dd HH:mm:ss")
        else:
            start_default = QDateTime.fromString("2025-07-22 00:00:00", "yyyy-MM-dd HH:mm:ss")
        self.start_dt = QDateTimeEdit(start_default)
        self.start_dt.setDisplayFormat("yyyy-MM-dd HH:mm:ss")
        self.start_dt.setCalendarPopup(True)
        start_layout.addWidget(self.start_label)
        start_layout.addWidget(self.start_dt)
        
        # End Time
        end_layout = QHBoxLayout()
        self.end_label = QLabel("종료 날짜 & 시간:")
        if end_str:
            end_default = QDateTime.fromString(end_str, "yyyy-MM-dd HH:mm:ss")
        else:
            end_default = QDateTime.fromString("2025-07-23 23:59:00", "yyyy-MM-dd HH:mm:ss")
        self.end_dt = QDateTimeEdit(end_default)
        self.end_dt.setDisplayFormat("yyyy-MM-dd HH:mm:ss")
        self.end_dt.setCalendarPopup(True)
        end_layout.addWidget(self.end_label)
        end_layout.addWidget(self.end_dt)
        
        # Download Button
        self.download_btn = QPushButton("설정된 기간 다운로드")
        self.download_btn.clicked.connect(self.accept)
        
        layout.addLayout(start_layout)
        layout.addLayout(end_layout)
        layout.addWidget(self.download_btn)
        
    def get_dates(self):
        """start_ms, end_ms, timeframe_key 반환"""
        tf_key = self.tf_combo.currentData()
        return (self.start_dt.dateTime().toMSecsSinceEpoch(),
                self.end_dt.dateTime().toMSecsSinceEpoch(),
                tf_key)

class LabelingDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("롱 숏 라벨링 설정")
        self.resize(300, 150)
        
        layout = QVBoxLayout(self)
        
        # Target Profit (%)
        tp_layout = QHBoxLayout()
        self.tp_label = QLabel("목표 수익률(%):")
        self.tp_spinbox = QDoubleSpinBox()
        self.tp_spinbox.setRange(0.01, 100.0)
        self.tp_spinbox.setSingleStep(0.1)
        self.tp_spinbox.setValue(1.0) # 기본 목표 수익률 1.0%
        tp_layout.addWidget(self.tp_label)
        tp_layout.addWidget(self.tp_spinbox)
        
        # Stop Loss (%)
        sl_layout = QHBoxLayout()
        self.sl_label = QLabel("관리 손실률(%):")
        self.sl_spinbox = QDoubleSpinBox()
        self.sl_spinbox.setRange(0.01, 100.0)
        self.sl_spinbox.setSingleStep(0.1)
        self.sl_spinbox.setValue(0.5) # 기본 손실률 0.5%
        sl_layout.addWidget(self.sl_label)
        sl_layout.addWidget(self.sl_spinbox)
        
        # Action Button
        self.action_btn = QPushButton("탐색 및 라벨링")
        self.action_btn.clicked.connect(self.accept)
        
        layout.addLayout(tp_layout)
        layout.addLayout(sl_layout)
        layout.addWidget(self.action_btn)
        
    def get_parameters(self):
        return self.tp_spinbox.value(), self.sl_spinbox.value()

class SMADialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("단순 이동 평균 및 라벨링 추가")
        self.resize(320, 200)
        
        layout = QVBoxLayout(self)
        
        period_layout = QHBoxLayout()
        self.period_label = QLabel("기간 (1~400):")
        self.period_spinbox = QSpinBox()
        self.period_spinbox.setRange(1, 400)
        self.period_spinbox.setValue(20) # 기본 20일/분
        period_layout.addWidget(self.period_label)
        period_layout.addWidget(self.period_spinbox)
        layout.addLayout(period_layout)
        
        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)
        
        self.ls_widget = QWidget()
        ls_layout = QVBoxLayout(self.ls_widget)
        ls_layout.setContentsMargins(0, 0, 0, 0)
        
        strategy_layout = QHBoxLayout()
        self.strategy_label = QLabel("전략 선택:")
        self.strategy_combo = QComboBox()
        self.strategy_combo.addItem("단순 돌파 전략")
        strategy_layout.addWidget(self.strategy_label)
        strategy_layout.addWidget(self.strategy_combo)
        
        offset_layout = QHBoxLayout()
        self.offset_label = QLabel("오프셋 (%):")
        self.offset_spinbox = QDoubleSpinBox()
        self.offset_spinbox.setRange(-100.0, 100.0)
        self.offset_spinbox.setSingleStep(0.1)
        self.offset_spinbox.setValue(0.0)
        offset_layout.addWidget(self.offset_label)
        offset_layout.addWidget(self.offset_spinbox)
        
        ls_layout.addLayout(strategy_layout)
        ls_layout.addLayout(offset_layout)
        
        self.ls_widget.setEnabled(False)
        self.ls_checkbox.toggled.connect(self.ls_widget.setEnabled)
        
        layout.addWidget(self.ls_widget)
        
        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)
        
    def get_settings(self):
        return (self.period_spinbox.value(), 
                self.ls_checkbox.isChecked(), 
                self.strategy_combo.currentText(), 
                self.offset_spinbox.value())

class SupertrendDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("3개의 슈퍼트렌드 설정")
        self.resize(420, 460)

        layout = QVBoxLayout(self)

        # 슈퍼트렌드 1~3 설정
        self.st_widgets = []
        for i in range(1, 4):
            group_label = QLabel(f"슈퍼트렌드 {i}")
            group_label.setStyleSheet("font-weight: bold; margin-top: 6px;")
            layout.addWidget(group_label)

            row = QHBoxLayout()

            atr_label = QLabel("ATR 기간:")
            atr_spin = QSpinBox()
            atr_spin.setRange(1, 200)
            atr_spin.setValue([10, 11, 12][i - 1])

            mult_label = QLabel("멀티플라이어:")
            mult_spin = QDoubleSpinBox()
            mult_spin.setRange(0.1, 20.0)
            mult_spin.setSingleStep(0.1)
            mult_spin.setValue([1.0, 2.0, 3.0][i - 1])

            row.addWidget(atr_label)
            row.addWidget(atr_spin)
            row.addSpacing(12)
            row.addWidget(mult_label)
            row.addWidget(mult_spin)

            layout.addLayout(row)
            self.st_widgets.append((atr_spin, mult_spin))

        # 구분선
        from PySide6.QtWidgets import QFrame
        line = QFrame()
        line.setFrameShape(QFrame.HLine)
        line.setFrameShadow(QFrame.Sunken)
        layout.addSpacing(6)
        layout.addWidget(line)
        layout.addSpacing(2)

        # LS 라벨링 체크박스
        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)

        # MA 설정 위젯 (LS 사용 시만 활성화)
        self.ma_widget = QWidget()
        ma_layout = QVBoxLayout(self.ma_widget)
        ma_layout.setContentsMargins(12, 0, 0, 0)

        type_row = QHBoxLayout()
        type_row.addWidget(QLabel("MA 종류:"))
        self.type_combo = QComboBox()
        self.type_combo.addItems(["SMA", "EMA"])
        type_row.addWidget(self.type_combo)
        ma_layout.addLayout(type_row)

        period_row = QHBoxLayout()
        period_row.addWidget(QLabel("MA 기간 (1~400):"))
        self.period_spin = QSpinBox()
        self.period_spin.setRange(1, 400)
        self.period_spin.setValue(20)
        period_row.addWidget(self.period_spin)
        ma_layout.addLayout(period_row)

        lookback_row = QHBoxLayout()
        lookback_row.addWidget(QLabel("기울기 룩백 (봉 수):"))
        self.lookback_spin = QSpinBox()
        self.lookback_spin.setRange(1, 200)
        self.lookback_spin.setValue(5)
        lookback_row.addWidget(self.lookback_spin)
        ma_layout.addLayout(lookback_row)

        self.ma_widget.setEnabled(False)
        self.ls_checkbox.toggled.connect(self.ma_widget.setEnabled)
        layout.addWidget(self.ma_widget)

        layout.addSpacing(8)
        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)

    def get_settings(self):
        """st_settings=[(atr,mult),...], use_ls, ma_type, ma_period, lookback 반환"""
        st = [(w[0].value(), w[1].value()) for w in self.st_widgets]
        use_ls = self.ls_checkbox.isChecked()
        return (
            st,
            use_ls,
            self.type_combo.currentText() if use_ls else None,
            self.period_spin.value()      if use_ls else None,
            self.lookback_spin.value()    if use_ls else None,
        )


class MASlopeDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("이동평균 기울기 설정")
        self.resize(340, 180)

        layout = QVBoxLayout(self)

        # MA 종류
        type_row = QHBoxLayout()
        type_row.addWidget(QLabel("MA 종류:"))
        self.type_combo = QComboBox()
        self.type_combo.addItems(["SMA", "EMA"])
        type_row.addWidget(self.type_combo)
        layout.addLayout(type_row)

        # MA 기간
        period_row = QHBoxLayout()
        period_row.addWidget(QLabel("MA 기간 (1~400):"))
        self.period_spin = QSpinBox()
        self.period_spin.setRange(1, 400)
        self.period_spin.setValue(20)
        period_row.addWidget(self.period_spin)
        layout.addLayout(period_row)

        # 기울기 룩백
        lookback_row = QHBoxLayout()
        lookback_row.addWidget(QLabel("기울기 룩백 (봉 수):"))
        self.lookback_spin = QSpinBox()
        self.lookback_spin.setRange(1, 200)
        self.lookback_spin.setValue(5)
        lookback_row.addWidget(self.lookback_spin)
        layout.addLayout(lookback_row)

        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addSpacing(8)
        layout.addWidget(self.action_btn)

    def get_settings(self):
        """(ma_type, ma_period, lookback) 반환"""
        return (self.type_combo.currentText(),
                self.period_spin.value(),
                self.lookback_spin.value())


class HullSuiteDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Hull Suite 설정")
        self.resize(320, 180)
        
        layout = QVBoxLayout(self)
        
        period_layout = QHBoxLayout()
        self.period_label = QLabel("기간 (1~400):")
        self.period_spinbox = QSpinBox()
        self.period_spinbox.setRange(1, 400)
        self.period_spinbox.setValue(55)
        period_layout.addWidget(self.period_label)
        period_layout.addWidget(self.period_spinbox)
        layout.addLayout(period_layout)
        
        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)
        
        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)
        
    def get_settings(self):
        return (self.period_spinbox.value(), self.ls_checkbox.isChecked())


class SqueezeDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Squeeze Momentum 설정")
        self.resize(320, 260)
        
        layout = QVBoxLayout(self)
        
        # BB
        bb_len_layout = QHBoxLayout()
        bb_len_layout.addWidget(QLabel("BB 기간:"))
        self.bb_len_spin = QSpinBox()
        self.bb_len_spin.setRange(1, 400)
        self.bb_len_spin.setValue(20)
        bb_len_layout.addWidget(self.bb_len_spin)
        layout.addLayout(bb_len_layout)
        
        bb_mult_layout = QHBoxLayout()
        bb_mult_layout.addWidget(QLabel("BB 승수:"))
        self.bb_mult_spin = QDoubleSpinBox()
        self.bb_mult_spin.setRange(0.1, 20.0)
        self.bb_mult_spin.setSingleStep(0.1)
        self.bb_mult_spin.setValue(2.0)
        bb_mult_layout.addWidget(self.bb_mult_spin)
        layout.addLayout(bb_mult_layout)
        
        # KC
        kc_len_layout = QHBoxLayout()
        kc_len_layout.addWidget(QLabel("KC 기간:"))
        self.kc_len_spin = QSpinBox()
        self.kc_len_spin.setRange(1, 400)
        self.kc_len_spin.setValue(20)
        kc_len_layout.addWidget(self.kc_len_spin)
        layout.addLayout(kc_len_layout)
        
        kc_mult_layout = QHBoxLayout()
        kc_mult_layout.addWidget(QLabel("KC 승수:"))
        self.kc_mult_spin = QDoubleSpinBox()
        self.kc_mult_spin.setRange(0.1, 20.0)
        self.kc_mult_spin.setSingleStep(0.1)
        self.kc_mult_spin.setValue(1.5)
        kc_mult_layout.addWidget(self.kc_mult_spin)
        layout.addLayout(kc_mult_layout)
        
        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)
        
        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)
        
    def get_settings(self):
        return (self.bb_len_spin.value(), self.bb_mult_spin.value(),
                self.kc_len_spin.value(), self.kc_mult_spin.value(),
                self.ls_checkbox.isChecked())


class WaveTrendDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("WaveTrend Oscillator 설정")
        self.resize(320, 310)
        
        layout = QVBoxLayout(self)
        
        ch_len_layout = QHBoxLayout()
        ch_len_layout.addWidget(QLabel("채널 기간:"))
        self.ch_len_spin = QSpinBox()
        self.ch_len_spin.setRange(1, 400)
        self.ch_len_spin.setValue(10)
        ch_len_layout.addWidget(self.ch_len_spin)
        layout.addLayout(ch_len_layout)
        
        avg_len_layout = QHBoxLayout()
        avg_len_layout.addWidget(QLabel("평균 기간:"))
        self.avg_len_spin = QSpinBox()
        self.avg_len_spin.setRange(1, 400)
        self.avg_len_spin.setValue(21)
        avg_len_layout.addWidget(self.avg_len_spin)
        layout.addLayout(avg_len_layout)
        
        wt2_len_layout = QHBoxLayout()
        wt2_len_layout.addWidget(QLabel("WT2 평균 기간:"))
        self.wt2_len_spin = QSpinBox()
        self.wt2_len_spin.setRange(1, 400)
        self.wt2_len_spin.setValue(4)
        wt2_len_layout.addWidget(self.wt2_len_spin)
        layout.addLayout(wt2_len_layout)
        
        ob_layout = QHBoxLayout()
        ob_layout.addWidget(QLabel("과매수 레벨 1:"))
        self.ob_spin = QSpinBox()
        self.ob_spin.setRange(0, 100)
        self.ob_spin.setValue(60)
        ob_layout.addWidget(self.ob_spin)
        layout.addLayout(ob_layout)
        
        os_layout = QHBoxLayout()
        os_layout.addWidget(QLabel("과매도 레벨 1:"))
        self.os_spin = QSpinBox()
        self.os_spin.setRange(-100, 0)
        self.os_spin.setValue(-60)
        os_layout.addWidget(self.os_spin)
        layout.addLayout(os_layout)

        cum_layout = QHBoxLayout()
        cum_layout.addWidget(QLabel("크로스 누적 횟수:"))
        self.cum_spin = QSpinBox()
        self.cum_spin.setRange(1, 10)
        self.cum_spin.setValue(1)
        cum_layout.addWidget(self.cum_spin)
        layout.addLayout(cum_layout)
        
        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)
        
        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)
        
    def get_settings(self):
        return (self.ch_len_spin.value(), self.avg_len_spin.value(), self.wt2_len_spin.value(),
                self.ob_spin.value(), self.os_spin.value(), self.cum_spin.value(),
                self.ls_checkbox.isChecked())


class MtfMacdDialog(QDialog):
    def __init__(self, parent=None, current_tf='1m'):
        super().__init__(parent)
        self.setWindowTitle("다중 타임프레임 MACD 설정")
        self.resize(320, 260)
        
        layout = QVBoxLayout(self)
        
        tf_layout = QHBoxLayout()
        tf_layout.addWidget(QLabel("대상 시간 틀:"))
        self.tf_combo = QComboBox()
        for key in TIMEFRAME_KEYS:
            self.tf_combo.addItem(TIMEFRAME_CONFIG[key]['label'], key)
        # 기본값은 현재 타임프레임보다 한 단계 높은 타임프레임 혹은 현재 타임프레임으로
        try:
            curr_idx = TIMEFRAME_KEYS.index(current_tf)
            default_idx = min(curr_idx + 1, len(TIMEFRAME_KEYS) - 1)
        except ValueError:
            default_idx = 0
        self.tf_combo.setCurrentIndex(default_idx)
        tf_layout.addWidget(self.tf_combo)
        layout.addLayout(tf_layout)
        
        fast_layout = QHBoxLayout()
        fast_layout.addWidget(QLabel("빠른 EMA 기간:"))
        self.fast_spin = QSpinBox()
        self.fast_spin.setRange(1, 400)
        self.fast_spin.setValue(12)
        fast_layout.addWidget(self.fast_spin)
        layout.addLayout(fast_layout)
        
        slow_layout = QHBoxLayout()
        slow_layout.addWidget(QLabel("느린 EMA 기간:"))
        self.slow_spin = QSpinBox()
        self.slow_spin.setRange(1, 400)
        self.slow_spin.setValue(26)
        slow_layout.addWidget(self.slow_spin)
        layout.addLayout(slow_layout)
        
        sig_layout = QHBoxLayout()
        sig_layout.addWidget(QLabel("시그널 기간:"))
        self.sig_spin = QSpinBox()
        self.sig_spin.setRange(1, 400)
        self.sig_spin.setValue(9)
        sig_layout.addWidget(self.sig_spin)
        layout.addLayout(sig_layout)
        
        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)
        
        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)
        
    def get_settings(self):
        return (self.tf_combo.currentData(), self.fast_spin.value(),
                self.slow_spin.value(), self.sig_spin.value(),
                self.ls_checkbox.isChecked())


class KalmanMtfMacdDialog(QDialog):
    def __init__(self, parent=None, current_tf='1m'):
        super().__init__(parent)
        self.setWindowTitle("칼만 필터 + MTF MACD 설정")
        self.resize(340, 360)

        layout = QVBoxLayout(self)

        # 타임프레임 선택
        tf_layout = QHBoxLayout()
        tf_layout.addWidget(QLabel("대상 시간 틀:"))
        self.tf_combo = QComboBox()
        for key in TIMEFRAME_KEYS:
            self.tf_combo.addItem(TIMEFRAME_CONFIG[key]['label'], key)
        try:
            curr_idx = TIMEFRAME_KEYS.index(current_tf)
            default_idx = min(curr_idx + 1, len(TIMEFRAME_KEYS) - 1)
        except ValueError:
            default_idx = 0
        self.tf_combo.setCurrentIndex(default_idx)
        tf_layout.addWidget(self.tf_combo)
        layout.addLayout(tf_layout)

        # 칼만 필터 파라미터
        from PySide6.QtWidgets import QGroupBox
        kalman_group = QGroupBox("칼만 필터 파라미터")
        kalman_layout = QVBoxLayout(kalman_group)

        q_layout = QHBoxLayout()
        q_layout.addWidget(QLabel("프로세스 노이즈 (Q):"))
        self.q_spin = QDoubleSpinBox()
        self.q_spin.setRange(0.0001, 10.0)
        self.q_spin.setDecimals(4)
        self.q_spin.setSingleStep(0.001)
        self.q_spin.setValue(0.01)
        q_layout.addWidget(self.q_spin)
        kalman_layout.addLayout(q_layout)

        r_layout = QHBoxLayout()
        r_layout.addWidget(QLabel("측정 노이즈 (R):"))
        self.r_spin = QDoubleSpinBox()
        self.r_spin.setRange(0.001, 100.0)
        self.r_spin.setDecimals(3)
        self.r_spin.setSingleStep(0.1)
        self.r_spin.setValue(1.0)
        r_layout.addWidget(self.r_spin)
        kalman_layout.addLayout(r_layout)

        layout.addWidget(kalman_group)

        # MACD 파라미터
        fast_layout = QHBoxLayout()
        fast_layout.addWidget(QLabel("빠른 EMA 기간:"))
        self.fast_spin = QSpinBox()
        self.fast_spin.setRange(1, 400)
        self.fast_spin.setValue(12)
        fast_layout.addWidget(self.fast_spin)
        layout.addLayout(fast_layout)

        slow_layout = QHBoxLayout()
        slow_layout.addWidget(QLabel("느린 EMA 기간:"))
        self.slow_spin = QSpinBox()
        self.slow_spin.setRange(1, 400)
        self.slow_spin.setValue(26)
        slow_layout.addWidget(self.slow_spin)
        layout.addLayout(slow_layout)

        sig_layout = QHBoxLayout()
        sig_layout.addWidget(QLabel("시그널 기간:"))
        self.sig_spin = QSpinBox()
        self.sig_spin.setRange(1, 400)
        self.sig_spin.setValue(9)
        sig_layout.addWidget(self.sig_spin)
        layout.addLayout(sig_layout)

        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)

        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)

    def get_settings(self):
        return (self.tf_combo.currentData(),
                self.q_spin.value(), self.r_spin.value(),
                self.fast_spin.value(), self.slow_spin.value(),
                self.sig_spin.value(), self.ls_checkbox.isChecked())


class MtfStochRsiDialog(QDialog):
    def __init__(self, parent=None, current_tf='1m'):
        super().__init__(parent)
        self.setWindowTitle("다중 타임프레임 Stochastic RSI 설정")
        self.resize(320, 340)
        
        layout = QVBoxLayout(self)
        
        tf_layout = QHBoxLayout()
        tf_layout.addWidget(QLabel("대상 시간 틀:"))
        self.tf_combo = QComboBox()
        for key in TIMEFRAME_KEYS:
            self.tf_combo.addItem(TIMEFRAME_CONFIG[key]['label'], key)
        try:
            curr_idx = TIMEFRAME_KEYS.index(current_tf)
            default_idx = min(curr_idx + 1, len(TIMEFRAME_KEYS) - 1)
        except ValueError:
            default_idx = 0
        self.tf_combo.setCurrentIndex(default_idx)
        tf_layout.addWidget(self.tf_combo)
        layout.addLayout(tf_layout)
        
        rsi_layout = QHBoxLayout()
        rsi_layout.addWidget(QLabel("RSI 기간:"))
        self.rsi_spin = QSpinBox()
        self.rsi_spin.setRange(1, 400)
        self.rsi_spin.setValue(14)
        rsi_layout.addWidget(self.rsi_spin)
        layout.addLayout(rsi_layout)
        
        stoch_layout = QHBoxLayout()
        stoch_layout.addWidget(QLabel("Stochastic 기간:"))
        self.stoch_spin = QSpinBox()
        self.stoch_spin.setRange(1, 400)
        self.stoch_spin.setValue(14)
        stoch_layout.addWidget(self.stoch_spin)
        layout.addLayout(stoch_layout)
        
        k_layout = QHBoxLayout()
        k_layout.addWidget(QLabel("K 스무딩:"))
        self.k_spin = QSpinBox()
        self.k_spin.setRange(1, 400)
        self.k_spin.setValue(3)
        k_layout.addWidget(self.k_spin)
        layout.addLayout(k_layout)
        
        d_layout = QHBoxLayout()
        d_layout.addWidget(QLabel("D 스무딩:"))
        self.d_spin = QSpinBox()
        self.d_spin.setRange(1, 400)
        self.d_spin.setValue(3)
        d_layout.addWidget(self.d_spin)
        layout.addLayout(d_layout)
        
        ob_layout = QHBoxLayout()
        ob_layout.addWidget(QLabel("과매수 레벨:"))
        self.ob_spin = QSpinBox()
        self.ob_spin.setRange(1, 100)
        self.ob_spin.setValue(80)
        ob_layout.addWidget(self.ob_spin)
        layout.addLayout(ob_layout)
        
        os_layout = QHBoxLayout()
        os_layout.addWidget(QLabel("과매도 레벨:"))
        self.os_spin = QSpinBox()
        self.os_spin.setRange(1, 100)
        self.os_spin.setValue(20)
        os_layout.addWidget(self.os_spin)
        layout.addLayout(os_layout)
        
        self.ls_checkbox = QCheckBox("LS 라벨링 적용")
        layout.addWidget(self.ls_checkbox)
        
        self.action_btn = QPushButton("차트에 추가")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)
        
    def get_settings(self):
        return (self.tf_combo.currentData(), self.rsi_spin.value(),
                self.stoch_spin.value(), self.k_spin.value(),
                self.d_spin.value(), self.ob_spin.value(),
                self.os_spin.value(), self.ls_checkbox.isChecked())



class BacktestDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("백테스트 설정")
        self.resize(300, 150)
        
        layout = QVBoxLayout(self)
        
        lev_layout = QHBoxLayout()
        self.lev_label = QLabel("레버리지:")
        self.lev_spinbox = QSpinBox()
        self.lev_spinbox.setRange(1, 125)
        self.lev_spinbox.setValue(1)
        lev_layout.addWidget(self.lev_label)
        lev_layout.addWidget(self.lev_spinbox)
        layout.addLayout(lev_layout)
        
        self.save_csv_checkbox = QCheckBox("거래 내역 CSV 저장")
        self.save_csv_checkbox.setChecked(True)
        layout.addWidget(self.save_csv_checkbox)
        
        self.action_btn = QPushButton("백테스트 실행")
        self.action_btn.clicked.connect(self.accept)
        layout.addWidget(self.action_btn)
        
    def get_settings(self):
        return self.lev_spinbox.value(), self.save_csv_checkbox.isChecked()


import matplotlib
matplotlib.use('QtAgg')
from matplotlib.backends.backend_qtagg import FigureCanvasQTAgg as FigureCanvas, NavigationToolbar2QT as NavigationToolbar
from matplotlib.figure import Figure
import mplfinance as mpf

class BinanceDataFetcher(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Binance Futures BTC OHLCV Downloader")
        # 가로는 기존(1000)의 2배, 세로는 기존(800)의 1.5배
        self.resize(2000, 1200)
        
        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)
        self.layout = QVBoxLayout(self.central_widget)
        
        # State for Indicators
        self.sma_periods = []
        self.supertrend_settings = []   # [(atr_period, multiplier), ...]
        self.ma_slope_settings = []     # [(ma_type, ma_period, lookback), ...]
        self.hull_suite_settings = []    # [length, ...]
        self.squeeze_settings = []       # [(bb_len, bb_mult, kc_len, kc_mult), ...]
        self.wavetrend_settings = []     # [(ch_len, avg_len, ob_level, os_level), ...]
        self.mtf_macd_settings = []      # [(tf_key, fast_len, slow_len, sig_len), ...]
        self.kalman_mtf_macd_settings = [] # [(tf_key, Q, R, fast_len, slow_len, sig_len), ...]
        self.mtf_stoch_rsi_settings = [] # [(tf_key, rsi_len, stoch_len, k_len, d_len, ob_level, os_level), ...]

        # 현재 선택된 타임프레임 (기본값: 1분)
        self.current_timeframe = '1m'
        
        # Setup Views (Chart and Table)
        self.setup_views()
        
        # Setup Status Bar
        self.setup_statusbar()
        
        # Setup Menu Bar
        self.setup_menu()
        
        # 앱 실행 직후 UI 렌더링이 완료되면 자동으로 다운로드 실행
        QTimer.singleShot(100, self.download_data)

    def setup_menu(self):
        menubar = self.menuBar()
        
        # '데이터' 메뉴 탭 생성
        data_menu = menubar.addMenu("데이터(&D)")
        
        # '데이터 다운로드...' 액션 추가
        download_action = QAction("데이터 다운로드...", self)
        download_action.setShortcut("Ctrl+D")
        download_action.triggered.connect(self.open_download_dialog)
        data_menu.addAction(download_action)
        
        data_menu.addSeparator()
        
        # '롱 숏 라벨링...' 액션 추가
        labeling_action = QAction("롱 숏 라벨링...", self)
        labeling_action.setShortcut("Ctrl+L")
        labeling_action.triggered.connect(self.open_labeling_dialog)
        data_menu.addAction(labeling_action)
        
        # '딥러닝 예측 라벨링...' 액션 추가
        dl_label_action = QAction("딥러닝 예측 라벨링...", self)
        dl_label_action.triggered.connect(self.apply_deep_learning_labeling)
        data_menu.addAction(dl_label_action)
        
        # '라벨 차트 표시' 액션 (토글형) 추가
        self.show_label_action = QAction("라벨 차트 표시", self)
        self.show_label_action.setCheckable(True)
        self.show_label_action.setChecked(False) # 기본값: 꺼짐
        self.show_label_action.triggered.connect(self.toggle_label_chart)
        data_menu.addAction(self.show_label_action)

        # '백테스트 실행...' 액션 추가 (기능은 추후 구현)
        backtest_action = QAction("백테스트 실행...", self)
        backtest_action.setShortcut("Ctrl+B")
        backtest_action.triggered.connect(self.run_backtest)
        data_menu.addAction(backtest_action)

        # '지표 설정' 메뉴 탭 생성
        indicator_menu = menubar.addMenu("지표 설정(&I)")
        
        sma_action = QAction("단순 이동 평균...", self)
        sma_action.triggered.connect(self.open_sma_dialog)
        indicator_menu.addAction(sma_action)

        supertrend_action = QAction("3개의 슈퍼트렌드...", self)
        supertrend_action.triggered.connect(self.open_supertrend_dialog)
        indicator_menu.addAction(supertrend_action)

        ma_slope_action = QAction("이동평균 기울기...", self)
        ma_slope_action.triggered.connect(self.open_ma_slope_dialog)
        indicator_menu.addAction(ma_slope_action)

        hull_action = QAction("Hull Suite...", self)
        hull_action.triggered.connect(self.open_hull_suite_dialog)
        indicator_menu.addAction(hull_action)

        squeeze_action = QAction("Squeeze Momentum...", self)
        squeeze_action.triggered.connect(self.open_squeeze_dialog)
        indicator_menu.addAction(squeeze_action)

        wt_action = QAction("WaveTrend Oscillator...", self)
        wt_action.triggered.connect(self.open_wavetrend_dialog)
        indicator_menu.addAction(wt_action)

        macd_action = QAction("다중 타임프레임 MACD...", self)
        macd_action.triggered.connect(self.open_mtf_macd_dialog)
        indicator_menu.addAction(macd_action)

        kalman_macd_action = QAction("칼만 필터 + MTF MACD...", self)
        kalman_macd_action.triggered.connect(self.open_kalman_mtf_macd_dialog)
        indicator_menu.addAction(kalman_macd_action)

        stoch_rsi_action = QAction("다중 타임프레임 Stochastic RSI...", self)
        stoch_rsi_action.triggered.connect(self.open_mtf_stoch_rsi_dialog)
        indicator_menu.addAction(stoch_rsi_action)

        indicator_menu.addSeparator()

        clear_indicator_action = QAction("지표 초기화", self)
        clear_indicator_action.triggered.connect(self.clear_indicators)
        indicator_menu.addAction(clear_indicator_action)

    def toggle_label_chart(self, checked):
        # 체크 여부가 변경될 때마다 화면(차트 및 표)을 다시 그려서 토글 상태 반영
        if hasattr(self, 'current_df') and not self.current_df.empty:
            self.populate_ui(self.current_df)

    def apply_sma_breakout_labeling(self, period, strategy, offset_pct):
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        import os
        
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "캐시 파일이 존재하지 않습니다. 데이터를 먼저 갱신하세요.")
            return
            
        self.setWindowTitle("Binance Futures BTC - 단순 돌파 연산 중...")
        QApplication.processEvents()
        
        try:
            df = pd.read_csv(cache_file)
            
            # SMA 계산 및 오프셋 적용 기준선 생성 (충분한 데이터 없으면 NaN)
            sma = df['close'].rolling(window=period).mean()
            upper_bound = sma * (1 + offset_pct / 100.0)
            lower_bound = sma * (1 - offset_pct / 100.0)
            
            opens = df['open'].values
            
            # 이전 오픈가와 이전 SMA선 접근을 위한 shift 연산
            prev_opens = np.roll(opens, 1)
            prev_opens[0] = opens[0]
            
            prev_upper = np.roll(upper_bound.values, 1)
            prev_lower = np.roll(lower_bound.values, 1)
            
            # 상향 돌파 및 하향 돌파 시그널 식별 (기준을 오프셋 밴드로 원복)
            cross_up = (prev_opens <= prev_upper) & (opens > upper_bound.values)
            cross_down = (prev_opens >= prev_lower) & (opens < lower_bound.values)
            
            # 상태 머신 로직: 이전의 state(label)를 유지하기 위해 Pandas ffill 활용
            signal_series = pd.Series(0, index=df.index)
            signal_series.loc[cross_up] = 1
            signal_series.loc[cross_down] = -1
            
            # 시그널이 없는 구간(0)을 NaN으로 만들어 ffill() 대상이 되게 함
            signal_series = signal_series.replace(0, np.nan)
            
            # 가장 첫 번째 값은 0으로 시작하도록 강제 지정
            if pd.isna(signal_series.iloc[0]):
                signal_series.iloc[0] = 0
                
            # NaN을 이전 상태값으로 덮어씌움 (ffill)
            df['ls_label'] = signal_series.ffill().fillna(0).astype(int).values
            df.to_csv(cache_file, index=False)
            
            QMessageBox.information(self, "라벨링 완료", f"이동평균({period}) 단순 돌파 전략(오프셋 {offset_pct}%) 데이터 갱신 완료!")
            
            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                # 캐시 파일을 데이터프레임으로 갱신 후 화면 리렌더링
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)
                
        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def open_sma_dialog(self):
        dialog = SMADialog(self)
        if dialog.exec():
            period, use_ls, strategy, offset = dialog.get_settings()
            
            if period not in self.sma_periods:
                self.sma_periods.append(period)
                
            if use_ls and strategy == "단순 돌파 전략":
                self.apply_sma_breakout_labeling(period, strategy, offset)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def open_supertrend_dialog(self):
        dialog = SupertrendDialog(self)
        if dialog.exec():
            st_settings, use_ls, ma_type, ma_period, lookback = dialog.get_settings()
            self.supertrend_settings = st_settings

            if use_ls:
                # MA 지표도 자동 등록 (MA 선 + Slope)
                if ma_type and ma_period and lookback:
                    if (ma_type, ma_period, lookback) not in self.ma_slope_settings:
                        self.ma_slope_settings.append((ma_type, ma_period, lookback))
                    if ma_period not in self.sma_periods:
                        self.sma_periods.append(ma_period)

                # LS 라벨링 수행
                self.apply_supertrend_ls_labeling(st_settings, ma_type, ma_period, lookback)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def apply_supertrend_ls_labeling(self, st_settings, ma_type, ma_period, lookback):
        """3개 슈퍼트렌드 + MA Slope 조건으로 ls_label 설정 후 화면 갱신"""
        import os
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "캐시 파일이 없습니다. 데이터를 먼저 받아오세요.")
            return

        self.setWindowTitle("Binance Futures BTC - 라벨링 연산 중...")
        QApplication.processEvents()

        try:
            df = pd.read_csv(cache_file)
            if 'ls_label' not in df.columns:
                df['ls_label'] = 0

            # 원본 df로 슈퍼트렌드 3개 계산
            raw = df[['open', 'high', 'low', 'close']].copy()
            directions = []
            for atr_p, mult in st_settings:
                _, d = self.calculate_supertrend(raw, atr_p, mult)
                directions.append(d)  # d[i] = 1(상승) or -1(하락)

            # MA 계산
            if ma_type == 'EMA':
                ma_series = df['close'].ewm(span=ma_period, adjust=False).mean()
            else:
                ma_series = df['close'].rolling(window=ma_period).mean()

            # MA Slope 계산
            slope_series = ma_series - ma_series.shift(lookback)

            opens = df['open'].values
            ma_vals = ma_series.values
            slope_vals = slope_series.values

            # 라벨 초기화 후 조건 적용
            labels = np.zeros(len(df), dtype=int)
            for i in range(len(df)):
                if np.isnan(slope_vals[i]) or np.isnan(ma_vals[i]):
                    continue
                bull_count = sum(1 for d in directions if d[i] == 1)
                bear_count = sum(1 for d in directions if d[i] == -1)

                # 조건 6: 상승
                if (slope_vals[i] > 0
                        and opens[i] > ma_vals[i]
                        and bull_count >= 2):
                    labels[i] = 1
                # 조건 7: 하락
                elif (slope_vals[i] < 0
                        and opens[i] < ma_vals[i]
                        and bear_count >= 2):
                    labels[i] = -1

            df['ls_label'] = labels
            df.to_csv(cache_file, index=False)

            QMessageBox.information(self, "라벨링 완료",
                                    f"슈퍼트렌드 + {ma_type}({ma_period}) Slope({lookback}) 조건으로 "
                                    f"LS 라벨 갱신 완료\n"
                                    f"Long: {(labels==1).sum()}개, Short: {(labels==-1).sum()}개")

            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)

        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def open_hull_suite_dialog(self):
        dialog = HullSuiteDialog(self)
        if dialog.exec():
            length, use_ls = dialog.get_settings()
            if length not in self.hull_suite_settings:
                self.hull_suite_settings.append(length)
            
            if use_ls:
                self.apply_hull_suite_ls_labeling(length)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def apply_hull_suite_ls_labeling(self, length):
        import os
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "캐시 파일이 없습니다. 데이터를 먼저 받아오세요.")
            return

        self.setWindowTitle("Binance Futures BTC - Hull Suite 라벨링 중...")
        QApplication.processEvents()

        try:
            df = pd.read_csv(cache_file)
            
            hma = self.calculate_hma(df['close'], length)
            prev_hma = hma.shift(1)
            
            labels = np.zeros(len(df), dtype=int)
            labels = np.where(hma > prev_hma, 1, np.where(hma < prev_hma, -1, 0))
            labels[np.isnan(hma)] = 0
            
            df['ls_label'] = labels
            df.to_csv(cache_file, index=False)

            QMessageBox.information(self, "라벨링 완료",
                                    f"Hull Suite({length}) 기준으로 "
                                    f"LS 라벨 갱신 완료\n"
                                    f"Long: {(labels==1).sum()}개, Short: {(labels==-1).sum()}개")

            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)

        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def open_squeeze_dialog(self):
        dialog = SqueezeDialog(self)
        if dialog.exec():
            bb_len, bb_mult, kc_len, kc_mult, use_ls = dialog.get_settings()
            setting = (bb_len, bb_mult, kc_len, kc_mult)
            if setting not in self.squeeze_settings:
                self.squeeze_settings.append(setting)
            
            if use_ls:
                self.apply_squeeze_ls_labeling(bb_len, bb_mult, kc_len, kc_mult)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def apply_squeeze_ls_labeling(self, bb_len, bb_mult, kc_len, kc_mult):
        import os
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "캐시 파일이 없습니다. 데이터를 먼저 받아오세요.")
            return

        self.setWindowTitle("Binance Futures BTC - Squeeze Momentum 라벨링 중...")
        QApplication.processEvents()

        try:
            df = pd.read_csv(cache_file)
            
            sqz_val, _, _ = self.calculate_squeeze_momentum(df, bb_len, bb_mult, kc_len, kc_mult)
            
            labels = np.where(sqz_val > 0, 1, np.where(sqz_val < 0, -1, 0))
            labels[np.isnan(sqz_val)] = 0
            
            df['ls_label'] = labels
            df.to_csv(cache_file, index=False)

            QMessageBox.information(self, "라벨링 완료",
                                    f"Squeeze Momentum 기준으로 "
                                    f"LS 라벨 갱신 완료\n"
                                    f"Long: {(labels==1).sum()}개, Short: {(labels==-1).sum()}개")

            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)

        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def open_wavetrend_dialog(self):
        dialog = WaveTrendDialog(self)
        if dialog.exec():
            ch_len, avg_len, wt2_len, ob_level, os_level, cross_count, use_ls = dialog.get_settings()
            setting = (ch_len, avg_len, wt2_len, ob_level, os_level, cross_count)
            if setting not in self.wavetrend_settings:
                self.wavetrend_settings.append(setting)
            
            if use_ls:
                self.apply_wavetrend_ls_labeling(ch_len, avg_len, wt2_len, ob_level, os_level, cross_count)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def apply_wavetrend_ls_labeling(self, ch_len, avg_len, wt2_len, ob_level, os_level, cross_count):
        import os
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "캐시 파일이 없습니다. 데이터를 먼저 받아오세요.")
            return

        self.setWindowTitle("Binance Futures BTC - WaveTrend 라벨링 중...")
        QApplication.processEvents()

        try:
            df = pd.read_csv(cache_file)
            
            wt1, wt2 = self.calculate_wavetrend(df, ch_len, avg_len, wt2_len)
            
            prev_wt1 = wt1.shift(1)
            prev_wt2 = wt2.shift(1)
            
            # 과매수/과매도 문턱값 적용 크로스오버 판별
            cross_up = (prev_wt1 <= prev_wt2) & (wt1 > wt2) & (wt1 <= os_level)
            cross_down = (prev_wt1 >= prev_wt2) & (wt1 < wt2) & (wt1 >= ob_level)
            
            # 동일 방향 크로스 누적 횟수 기반 포지션 결정 상태 머신
            labels = np.zeros(len(df), dtype=int)
            current_position = 0
            long_signal_count = 0
            short_signal_count = 0
            
            cross_up_vals = cross_up.values
            cross_down_vals = cross_down.values
            wt1_nan = wt1.isna().values
            wt2_nan = wt2.isna().values
            
            for i in range(len(df)):
                if wt1_nan[i] or wt2_nan[i]:
                    labels[i] = 0
                    continue
                    
                if cross_up_vals[i]:
                    short_signal_count = 0  # 반대 방향 누적 리셋
                    long_signal_count += 1
                    if long_signal_count >= cross_count:
                        current_position = 1
                        long_signal_count = 0  # 포지션 진입 후 카운트 리셋
                        
                elif cross_down_vals[i]:
                    long_signal_count = 0   # 반대 방향 누적 리셋
                    short_signal_count += 1
                    if short_signal_count >= cross_count:
                        current_position = -1
                        short_signal_count = 0 # 포지션 진입 후 카운트 리셋
                        
                labels[i] = current_position
            
            df['ls_label'] = labels
            df.to_csv(cache_file, index=False)

            QMessageBox.information(self, "라벨링 완료",
                                    f"WaveTrend 기준으로 "
                                    f"LS 라벨 갱신 완료\n"
                                    f"Long: {(labels==1).sum()}개, Short: {(labels==-1).sum()}개")

            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)

        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def open_mtf_macd_dialog(self):
        dialog = MtfMacdDialog(self, current_tf=self.current_timeframe)
        if dialog.exec():
            tf_key, fast_len, slow_len, sig_len, use_ls = dialog.get_settings()
            setting = (tf_key, fast_len, slow_len, sig_len)
            if setting not in self.mtf_macd_settings:
                self.mtf_macd_settings.append(setting)
            
            # 대상 시간틀 데이터 자동 다운로드 및 캐시
            cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
            import os
            start_ms = getattr(self, 'last_start_ms', None)
            end_ms = getattr(self, 'last_end_ms', None)
            
            if start_ms is None or end_ms is None:
                if os.path.exists(cache_file):
                    df_curr = pd.read_csv(cache_file)
                    if not df_curr.empty:
                        start_ms = int(df_curr['timestamp'].min())
                        end_ms = int(df_curr['timestamp'].max())
            
            if start_ms is not None and end_ms is not None:
                # EMA 웜업용 기간 확보 (slow_len + sig_len) * 4 봉
                warmup_bars = (slow_len + sig_len) * 4
                target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
                start_download_ms = start_ms - (target_ms * warmup_bars)
                end_download_ms = end_ms
                
                # 안내 타이틀 표시
                self.setWindowTitle(f"Binance Futures BTC - 대상 시간틀({tf_key}) 데이터 확인/다운로드 중...")
                QApplication.processEvents()
                
                self.download_data(start_download_ms, end_download_ms, timeframe=tf_key, quiet=True)
                
                self.setWindowTitle("Binance Futures BTC OHLCV Downloader")
                QApplication.processEvents()
            
            if use_ls:
                self.apply_mtf_macd_ls_labeling(tf_key, fast_len, slow_len, sig_len)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def apply_mtf_macd_ls_labeling(self, tf_key, fast_len, slow_len, sig_len):
        import os
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        target_cache_file = TIMEFRAME_CONFIG[tf_key]['cache']
        
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "현재 타임프레임의 캐시 파일이 없습니다.")
            return
        if not os.path.exists(target_cache_file):
            QMessageBox.warning(self, "오류", f"대상 타임프레임({tf_key})의 캐시 파일이 없습니다. 먼저 해당 데이터를 받아오세요.")
            return

        self.setWindowTitle(f"Binance Futures BTC - MTF MACD({tf_key}) 라벨링 중...")
        QApplication.processEvents()

        try:
            df_curr = pd.read_csv(cache_file)
            df_target = pd.read_csv(target_cache_file)
            
            macd_line, sig_line, _ = self.calculate_macd(df_target['close'], fast_len, slow_len, sig_len)
            df_target['mtf_macd'] = macd_line
            df_target['mtf_sig'] = sig_line
            
            # 완성된 캔들만 사용하기 위해 타임스탬프를 캔들 종료 시점으로 이동 (Lookahead Bias 방지)
            target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
            df_target['timestamp_shifted'] = df_target['timestamp'] + target_ms
            
            df_curr_sorted = df_curr.sort_values('timestamp')
            df_target_sorted = df_target[['timestamp_shifted', 'mtf_macd', 'mtf_sig']].sort_values('timestamp_shifted')
            
            merged = pd.merge_asof(
                df_curr_sorted,
                df_target_sorted,
                left_on='timestamp',
                right_on='timestamp_shifted',
                direction='backward'
            )
            
            labels = np.where(merged['mtf_macd'] > merged['mtf_sig'], 1, -1)
            labels[merged['mtf_macd'].isna() | merged['mtf_sig'].isna()] = 0
            
            df_curr['ls_label'] = labels
            df_curr.to_csv(cache_file, index=False)

            QMessageBox.information(self, "라벨링 완료",
                                    f"MTF MACD({tf_key}, {fast_len}/{slow_len}/{sig_len}) 기준으로 "
                                    f"LS 라벨 갱신 완료\n"
                                    f"Long: {(labels==1).sum()}개, Short: {(labels==-1).sum()}개")

            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)

        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def calculate_wma(self, series, length):
        if len(series) < length:
            return pd.Series(np.nan, index=series.index)
        weights = np.arange(1, length + 1)
        return series.rolling(length).apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)

    def calculate_hma(self, series, length):
        half_len = int(length / 2)
        sqrt_len = int(np.sqrt(length))
        wma_half = self.calculate_wma(series, half_len)
        wma_full = self.calculate_wma(series, length)
        raw_hma = 2 * wma_half - wma_full
        hma = self.calculate_wma(raw_hma, sqrt_len)
        return hma

    def calculate_squeeze_momentum(self, df, bb_len, bb_mult, kc_len, kc_mult):
        close = df['close']
        high = df['high']
        low = df['low']
        
        basis = close.rolling(bb_len).mean()
        dev = bb_mult * close.rolling(bb_len).std()
        upperBB = basis + dev
        lowerBB = basis - dev
        
        ma = close.rolling(kc_len).mean()
        tr = np.zeros(len(df))
        tr[0] = high.iloc[0] - low.iloc[0]
        high_vals = high.values
        low_vals = low.values
        close_vals = close.values
        for i in range(1, len(df)):
            tr[i] = max(high_vals[i] - low_vals[i],
                        abs(high_vals[i] - close_vals[i - 1]),
                        abs(low_vals[i] - close_vals[i - 1]))
        tr_series = pd.Series(tr, index=df.index)
        rangema = tr_series.rolling(kc_len).mean()
        
        upperKC = ma + rangema * kc_mult
        lowerKC = ma - rangema * kc_mult
        
        sqzOn = (lowerBB > lowerKC) & (upperBB < upperKC)
        sqzOff = (lowerBB < lowerKC) | (upperBB > upperKC)
        
        highest_high = high.rolling(kc_len).max()
        lowest_low = low.rolling(kc_len).min()
        avg = (highest_high + lowest_low) / 2.0 + ma
        val_to_fit = close - avg / 2.0
        
        sqz_val = self.calculate_linreg(val_to_fit, kc_len)
        
        return sqz_val, sqzOn, sqzOff

    def calculate_linreg(self, series, length):
        if len(series) < length:
            return pd.Series(np.nan, index=series.index)
        x = np.arange(length)
        x_mean = x.mean()
        x_var = ((x - x_mean)**2).sum()
        x_dev = x - x_mean
        
        def get_linreg_val(y):
            y_mean = y.mean()
            slope = np.dot(y - y_mean, x_dev) / x_var
            return y_mean + slope * (length - 1) / 2
            
        return series.rolling(length).apply(get_linreg_val, raw=True)

    def calculate_wavetrend(self, df, ch_len, avg_len, wt2_len):
        ap = (df['high'] + df['low'] + df['close']) / 3.0
        esa = ap.ewm(span=ch_len, adjust=False).mean()
        d = (ap - esa).abs().ewm(span=ch_len, adjust=False).mean()
        ci = (ap - esa) / (0.015 * d)
        wt1 = ci.ewm(span=avg_len, adjust=False).mean()
        wt2 = wt1.rolling(wt2_len).mean()
        return wt1, wt2

    def calculate_macd(self, series, fast_len, slow_len, sig_len):
        ema_fast = series.ewm(span=fast_len, adjust=False).mean()
        ema_slow = series.ewm(span=slow_len, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=sig_len, adjust=False).mean()
        hist = macd_line - signal_line
        return macd_line, signal_line, hist

    def get_mtf_macd_for_df(self, plot_df, tf_key, fast_len, slow_len, sig_len):
        import os
        target_cache_file = TIMEFRAME_CONFIG[tf_key]['cache']
        if not os.path.exists(target_cache_file):
            return None, None, None
            
        df_target = pd.read_csv(target_cache_file)
        if df_target.empty:
            return None, None, None
            
        macd_line, sig_line, hist = self.calculate_macd(df_target['close'], fast_len, slow_len, sig_len)
        df_target['mtf_macd'] = macd_line
        df_target['mtf_sig'] = sig_line
        df_target['mtf_hist'] = hist
        
        # 완성된 캔들만 사용하기 위해 타임스탬프를 캔들 종료 시점으로 이동 (Lookahead Bias 방지)
        target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
        df_target['timestamp_dt'] = pd.to_datetime(df_target['timestamp'] + target_ms, unit='ms') + pd.Timedelta(hours=9)
        
        temp_df = plot_df.copy().reset_index()
        temp_df_sorted = temp_df.sort_values('timestamp')
        df_target_sorted = df_target[['timestamp_dt', 'mtf_macd', 'mtf_sig', 'mtf_hist']].sort_values('timestamp_dt')
        
        merged = pd.merge_asof(
            temp_df_sorted,
            df_target_sorted,
            left_on='timestamp',
            right_on='timestamp_dt',
            direction='backward'
        )
        merged.set_index('timestamp', inplace=True)
        return merged['mtf_macd'], merged['mtf_sig'], merged['mtf_hist']

    def open_ma_slope_dialog(self):
        dialog = MASlopeDialog(self)
        if dialog.exec():
            setting = dialog.get_settings()  # (ma_type, ma_period, lookback)
            self.ma_slope_settings.append(setting)
            if hasattr(self, 'current_df') and not self.current_df.empty:
                self.populate_ui(self.current_df)

    def calculate_supertrend(self, df, atr_period, multiplier):
        """TradingView 방식의 슈퍼트렌드 계산.
        - ATR: RMA(Wilder's 평활이동평균, alpha=1/period)
        - 밴드: 이전 밴드값과 비교하여 한 방향으로만 수렴
        - direction: 1=상승(bullish), -1=하락(bearish)
        """
        high  = df['high'].values.astype(float)
        low   = df['low'].values.astype(float)
        close = df['close'].values.astype(float)
        n = len(close)

        # True Range
        tr = np.zeros(n)
        tr[0] = high[0] - low[0]
        for i in range(1, n):
            tr[i] = max(high[i] - low[i],
                        abs(high[i] - close[i - 1]),
                        abs(low[i]  - close[i - 1]))

        # ATR via RMA (Wilder's smoothing): 첫 값은 단순평균으로 시드
        atr = np.zeros(n)
        seed_end = min(atr_period, n)
        atr[seed_end - 1] = np.mean(tr[:seed_end])
        alpha = 1.0 / atr_period
        for i in range(seed_end, n):
            atr[i] = alpha * tr[i] + (1.0 - alpha) * atr[i - 1]

        # 기본 밴드
        hl2 = (high + low) / 2.0
        basic_upper = hl2 + multiplier * atr
        basic_lower = hl2 - multiplier * atr

        # 최종 밴드 & 슈퍼트렌드
        final_upper = np.copy(basic_upper)
        final_lower = np.copy(basic_lower)
        supertrend  = np.zeros(n)
        direction   = np.zeros(n, dtype=int)

        # 초기 방향 결정
        direction[0] = 1 if close[0] >= final_lower[0] else -1
        supertrend[0] = final_lower[0] if direction[0] == 1 else final_upper[0]

        for i in range(1, n):
            # Final Upper: 새 밴드가 이전 밴드보다 낮거나, 이전 종가가 이전 밴드를 상향 돌파하면 갱신
            if basic_upper[i] < final_upper[i - 1] or close[i - 1] > final_upper[i - 1]:
                final_upper[i] = basic_upper[i]
            else:
                final_upper[i] = final_upper[i - 1]

            # Final Lower: 새 밴드가 이전 밴드보다 높거나, 이전 종가가 이전 밴드를 하향 돌파하면 갱신
            if basic_lower[i] > final_lower[i - 1] or close[i - 1] < final_lower[i - 1]:
                final_lower[i] = basic_lower[i]
            else:
                final_lower[i] = final_lower[i - 1]

            # 방향 전환 판정
            if direction[i - 1] == -1:   # 이전이 하락(bearish)
                if close[i] > final_upper[i]:
                    direction[i] = 1
                    supertrend[i] = final_lower[i]
                else:
                    direction[i] = -1
                    supertrend[i] = final_upper[i]
            else:                         # 이전이 상승(bullish)
                if close[i] < final_lower[i]:
                    direction[i] = -1
                    supertrend[i] = final_upper[i]
                else:
                    direction[i] = 1
                    supertrend[i] = final_lower[i]

        return supertrend, direction

    def clear_indicators(self):
        if (self.sma_periods or self.supertrend_settings or self.ma_slope_settings or
            self.hull_suite_settings or self.squeeze_settings or self.wavetrend_settings or
            self.mtf_macd_settings or self.kalman_mtf_macd_settings or self.mtf_stoch_rsi_settings):
            
            self.sma_periods.clear()
            self.supertrend_settings.clear()
            self.ma_slope_settings.clear()
            self.hull_suite_settings.clear()
            self.squeeze_settings.clear()
            self.wavetrend_settings.clear()
            self.mtf_macd_settings.clear()
            self.kalman_mtf_macd_settings.clear()
            self.mtf_stoch_rsi_settings.clear()
            
            if hasattr(self, 'current_df') and not self.current_df.empty:
                self.populate_ui(self.current_df)
            QMessageBox.information(self, "지표 초기화", "추가된 모든 지표가 차트에서 제거되었습니다.")

    def calculate_kalman_filter(self, series, Q=0.01, R=1.0):
        """1D 칼만 필터로 가격 시계열을 평활화.
        - Q: 프로세스 노이즈 공분산 (작을수록 부드러움, 클수록 원본에 가까움)
        - R: 측정 노이즈 공분산 (클수록 관측값을 덜 신뢰 → 더 부드러움)
        반환: 평활화된 가격 Series
        """
        values = series.values.astype(float)
        n = len(values)
        
        # 초기 상태: 첫 번째 관측값으로 설정
        x_hat = values[0]   # 상태 추정값
        P = 1.0             # 추정 오차 공분산
        
        filtered = np.zeros(n)
        filtered[0] = x_hat
        
        for i in range(1, n):
            # 예측 단계 (Predict)
            x_hat_minus = x_hat       # 상태 전이: x(k) = x(k-1) (랜덤워크 모델)
            P_minus = P + Q           # 오차 공분산 예측
            
            # 갱신 단계 (Update)
            K = P_minus / (P_minus + R)   # 칼만 게인
            x_hat = x_hat_minus + K * (values[i] - x_hat_minus)  # 상태 갱신
            P = (1 - K) * P_minus         # 오차 공분산 갱신
            
            filtered[i] = x_hat
        
        return pd.Series(filtered, index=series.index)

    def calculate_kalman_macd(self, series, Q, R, fast_len, slow_len, sig_len):
        """칼만 필터로 가격을 평활한 뒤 표준 MACD를 계산.
        방식 A: Price → Kalman Filter → EMA(fast) - EMA(slow) → Signal
        """
        smoothed = self.calculate_kalman_filter(series, Q, R)
        return self.calculate_macd(smoothed, fast_len, slow_len, sig_len)

    def open_kalman_mtf_macd_dialog(self):
        dialog = KalmanMtfMacdDialog(self, current_tf=self.current_timeframe)
        if dialog.exec():
            tf_key, Q, R, fast_len, slow_len, sig_len, use_ls = dialog.get_settings()
            setting = (tf_key, Q, R, fast_len, slow_len, sig_len)
            if setting not in self.kalman_mtf_macd_settings:
                self.kalman_mtf_macd_settings.append(setting)

            # 대상 시간틀 데이터 자동 다운로드 및 캐시
            cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
            import os
            start_ms = getattr(self, 'last_start_ms', None)
            end_ms = getattr(self, 'last_end_ms', None)

            if start_ms is None or end_ms is None:
                if os.path.exists(cache_file):
                    df_curr = pd.read_csv(cache_file)
                    if not df_curr.empty:
                        start_ms = int(df_curr['timestamp'].min())
                        end_ms = int(df_curr['timestamp'].max())

            if start_ms is not None and end_ms is not None:
                # EMA 웜업용 기간 확보
                warmup_bars = (slow_len + sig_len) * 4
                target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
                start_download_ms = start_ms - (target_ms * warmup_bars)
                end_download_ms = end_ms

                self.setWindowTitle(f"Binance Futures BTC - 대상 시간틀({tf_key}) 데이터 확인/다운로드 중...")
                QApplication.processEvents()

                self.download_data(start_download_ms, end_download_ms, timeframe=tf_key, quiet=True)

                self.setWindowTitle("Binance Futures BTC OHLCV Downloader")
                QApplication.processEvents()

            if use_ls:
                self.apply_kalman_mtf_macd_ls_labeling(tf_key, Q, R, fast_len, slow_len, sig_len)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def apply_kalman_mtf_macd_ls_labeling(self, tf_key, Q, R, fast_len, slow_len, sig_len):
        import os
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        target_cache_file = TIMEFRAME_CONFIG[tf_key]['cache']

        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "현재 타임프레임의 캐시 파일이 없습니다.")
            return
        if not os.path.exists(target_cache_file):
            QMessageBox.warning(self, "오류", f"대상 타임프레임({tf_key})의 캐시 파일이 없습니다. 먼저 해당 데이터를 받아오세요.")
            return

        self.setWindowTitle(f"Binance Futures BTC - Kalman MTF MACD({tf_key}) 라벨링 중...")
        QApplication.processEvents()

        try:
            df_curr = pd.read_csv(cache_file)
            df_target = pd.read_csv(target_cache_file)

            macd_line, sig_line, _ = self.calculate_kalman_macd(
                df_target['close'], Q, R, fast_len, slow_len, sig_len)
            df_target['k_mtf_macd'] = macd_line
            df_target['k_mtf_sig'] = sig_line

            # 완성된 캔들만 사용하기 위해 타임스탬프를 캔들 종료 시점으로 이동 (Lookahead Bias 방지)
            target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
            df_target['timestamp_shifted'] = df_target['timestamp'] + target_ms

            df_curr_sorted = df_curr.sort_values('timestamp')
            df_target_sorted = df_target[['timestamp_shifted', 'k_mtf_macd', 'k_mtf_sig']].sort_values('timestamp_shifted')

            merged = pd.merge_asof(
                df_curr_sorted,
                df_target_sorted,
                left_on='timestamp',
                right_on='timestamp_shifted',
                direction='backward'
            )

            labels = np.where(merged['k_mtf_macd'] > merged['k_mtf_sig'], 1, -1)
            labels[merged['k_mtf_macd'].isna() | merged['k_mtf_sig'].isna()] = 0

            df_curr['ls_label'] = labels
            df_curr.to_csv(cache_file, index=False)

            QMessageBox.information(self, "라벨링 완료",
                                    f"Kalman MTF MACD({tf_key}, Q={Q}, R={R}, {fast_len}/{slow_len}/{sig_len}) 기준으로 "
                                    f"LS 라벨 갱신 완료\n"
                                    f"Long: {(labels==1).sum()}개, Short: {(labels==-1).sum()}개")

            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)

        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def get_kalman_mtf_macd_for_df(self, plot_df, tf_key, Q, R, fast_len, slow_len, sig_len):
        """차트 표시용: 상위 타임프레임에서 Kalman MACD를 계산하여 하위 타임프레임에 매핑"""
        import os
        target_cache_file = TIMEFRAME_CONFIG[tf_key]['cache']
        if not os.path.exists(target_cache_file):
            return None, None, None

        df_target = pd.read_csv(target_cache_file)
        if df_target.empty:
            return None, None, None

        macd_line, sig_line, hist = self.calculate_kalman_macd(
            df_target['close'], Q, R, fast_len, slow_len, sig_len)
        df_target['k_mtf_macd'] = macd_line
        df_target['k_mtf_sig'] = sig_line
        df_target['k_mtf_hist'] = hist

        # 완성된 캔들만 사용하기 위해 타임스탬프를 캔들 종료 시점으로 이동 (Lookahead Bias 방지)
        target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
        df_target['timestamp_dt'] = pd.to_datetime(df_target['timestamp'] + target_ms, unit='ms') + pd.Timedelta(hours=9)

        temp_df = plot_df.copy().reset_index()
        temp_df_sorted = temp_df.sort_values('timestamp')
        df_target_sorted = df_target[['timestamp_dt', 'k_mtf_macd', 'k_mtf_sig', 'k_mtf_hist']].sort_values('timestamp_dt')

        merged = pd.merge_asof(
            temp_df_sorted,
            df_target_sorted,
            left_on='timestamp',
            right_on='timestamp_dt',
            direction='backward'
        )
        merged.set_index('timestamp', inplace=True)
        return merged['k_mtf_macd'], merged['k_mtf_sig'], merged['k_mtf_hist']

    def calculate_stoch_rsi(self, series, rsi_len, stoch_len, k_len, d_len):
        delta = series.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        
        avg_gain = gain.ewm(alpha=1/rsi_len, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1/rsi_len, adjust=False).mean()
        
        rs = avg_gain / (avg_loss + 1e-9)
        rsi = 100 - (100 / (1 + rs))
        
        min_rsi = rsi.rolling(window=stoch_len).min()
        max_rsi = rsi.rolling(window=stoch_len).max()
        
        stoch = 100 * (rsi - min_rsi) / (max_rsi - min_rsi + 1e-9)
        
        k = stoch.rolling(window=k_len).mean()
        d = k.rolling(window=d_len).mean()
        
        return k, d

    def get_mtf_stoch_rsi_for_df(self, plot_df, tf_key, rsi_len, stoch_len, k_len, d_len):
        import os
        target_cache_file = TIMEFRAME_CONFIG[tf_key]['cache']
        if not os.path.exists(target_cache_file):
            return None, None
            
        df_target = pd.read_csv(target_cache_file)
        if df_target.empty:
            return None, None
            
        k_line, d_line = self.calculate_stoch_rsi(df_target['close'], rsi_len, stoch_len, k_len, d_len)
        df_target['mtf_k'] = k_line
        df_target['mtf_d'] = d_line
        
        target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
        df_target['timestamp_dt'] = pd.to_datetime(df_target['timestamp'] + target_ms, unit='ms') + pd.Timedelta(hours=9)
        
        temp_df = plot_df.copy().reset_index()
        temp_df_sorted = temp_df.sort_values('timestamp')
        df_target_sorted = df_target[['timestamp_dt', 'mtf_k', 'mtf_d']].sort_values('timestamp_dt')
        
        merged = pd.merge_asof(
            temp_df_sorted,
            df_target_sorted,
            left_on='timestamp',
            right_on='timestamp_dt',
            direction='backward'
        )
        merged.set_index('timestamp', inplace=True)
        return merged['mtf_k'], merged['mtf_d']

    def open_mtf_stoch_rsi_dialog(self):
        dialog = MtfStochRsiDialog(self, current_tf=self.current_timeframe)
        if dialog.exec():
            tf_key, rsi_len, stoch_len, k_len, d_len, ob_level, os_level, use_ls = dialog.get_settings()
            setting = (tf_key, rsi_len, stoch_len, k_len, d_len, ob_level, os_level)
            if setting not in self.mtf_stoch_rsi_settings:
                self.mtf_stoch_rsi_settings.append(setting)
            
            cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
            import os
            start_ms = getattr(self, 'last_start_ms', None)
            end_ms = getattr(self, 'last_end_ms', None)
            
            if start_ms is None or end_ms is None:
                if os.path.exists(cache_file):
                    df_curr = pd.read_csv(cache_file)
                    if not df_curr.empty:
                        start_ms = int(df_curr['timestamp'].min())
                        end_ms = int(df_curr['timestamp'].max())
            
            if start_ms is not None and end_ms is not None:
                warmup_bars = max(rsi_len, stoch_len, k_len, d_len) * 4
                target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
                start_download_ms = start_ms - (target_ms * warmup_bars)
                end_download_ms = end_ms
                
                self.setWindowTitle(f"Binance Futures BTC - 대상 시간틀({tf_key}) 데이터 확인/다운로드 중...")
                QApplication.processEvents()
                
                self.download_data(start_download_ms, end_download_ms, timeframe=tf_key, quiet=True)
                
                self.setWindowTitle("Binance Futures BTC OHLCV Downloader")
                QApplication.processEvents()
            
            if use_ls:
                self.apply_mtf_stoch_rsi_ls_labeling(tf_key, rsi_len, stoch_len, k_len, d_len, ob_level, os_level)
            else:
                if hasattr(self, 'current_df') and not self.current_df.empty:
                    self.populate_ui(self.current_df)

    def apply_mtf_stoch_rsi_ls_labeling(self, tf_key, rsi_len, stoch_len, k_len, d_len, ob_level, os_level):
        import os
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        target_cache_file = TIMEFRAME_CONFIG[tf_key]['cache']
        
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "현재 타임프레임의 캐시 파일이 없습니다.")
            return
        if not os.path.exists(target_cache_file):
            QMessageBox.warning(self, "오류", f"대상 타임프레임({tf_key})의 캐시 파일이 없습니다. 먼저 해당 데이터를 받아오세요.")
            return

        self.setWindowTitle(f"Binance Futures BTC - MTF Stoch RSI({tf_key}) 라벨링 중...")
        QApplication.processEvents()

        try:
            df_curr = pd.read_csv(cache_file)
            df_target = pd.read_csv(target_cache_file)
            
            k_line, d_line = self.calculate_stoch_rsi(df_target['close'], rsi_len, stoch_len, k_len, d_len)
            df_target['mtf_k'] = k_line
            df_target['mtf_d'] = d_line
            
            target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
            df_target['timestamp_shifted'] = df_target['timestamp'] + target_ms
            
            df_curr_sorted = df_curr.sort_values('timestamp')
            df_target_sorted = df_target[['timestamp_shifted', 'mtf_k', 'mtf_d']].sort_values('timestamp_shifted')
            
            merged = pd.merge_asof(
                df_curr_sorted,
                df_target_sorted,
                left_on='timestamp',
                right_on='timestamp_shifted',
                direction='backward'
            )
            
            # K 크로스 D 전략 (과매수/과매도 구간 크로스오버 유지)
            k = merged['mtf_k'].values
            d = merged['mtf_d'].values
            
            prev_k = np.roll(k, 1)
            prev_k[0] = np.nan
            prev_d = np.roll(d, 1)
            prev_d[0] = np.nan
            
            golden_cross = (prev_k <= prev_d) & (k > d)
            dead_cross = (prev_k >= prev_d) & (k < d)
            
            long_signal = golden_cross & ((k <= os_level) | (prev_k <= os_level))
            short_signal = dead_cross & ((k >= ob_level) | (prev_k >= ob_level))
            
            signal_series = pd.Series(0, index=merged.index)
            signal_series.loc[long_signal] = 1
            signal_series.loc[short_signal] = -1
            
            signal_series = signal_series.replace(0, np.nan)
            if pd.isna(signal_series.iloc[0]):
                signal_series.iloc[0] = 0
                
            labels = signal_series.ffill().fillna(0).astype(int).values
            labels[np.isnan(k) | np.isnan(d)] = 0
            
            df_curr['ls_label'] = labels
            df_curr.to_csv(cache_file, index=False)

            QMessageBox.information(self, "라벨링 완료",
                                    f"MTF Stoch RSI({tf_key}) 기준으로 "
                                    f"LS 라벨 갱신 완료\n"
                                    f"Long: {(labels==1).sum()}개, Short: {(labels==-1).sum()}개")

            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)

        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")

    def setup_statusbar(self):
        self.statusBar = QStatusBar()
        self.setStatusBar(self.statusBar)
        
        # 라벨링 진행률을 표시할 프로그레스 바 
        self.progress_bar = QProgressBar()
        self.progress_bar.setMaximumWidth(200)
        self.progress_bar.setVisible(False)
        self.statusBar.addPermanentWidget(self.progress_bar)

    def open_labeling_dialog(self):
        dialog = LabelingDialog(self)
        if dialog.exec():
            target_profit, stop_loss = dialog.get_parameters()
            self.apply_labeling(target_profit, stop_loss)

    def apply_labeling(self, target_profit_pct, stop_loss_pct):
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        import os
        
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "캐시 파일이 존재하지 않습니다. 데이터를 먼저 갱신하세요.")
            return
            
        # 연산 집중 시 UI 멈춤을 방지하기 위한 안내
        self.setWindowTitle("Binance Futures BTC OHLCV Downloader - 라벨링 연산 중...")
        QApplication.processEvents()
        
        try:
            df = pd.read_csv(cache_file)
            if 'ls_label' not in df.columns:
                df['ls_label'] = 0
                
            labels = np.zeros(len(df), dtype=int)
            opens = df['open'].values
            highs = df['high'].values
            lows = df['low'].values
            
            tp = target_profit_pct / 100.0
            sl = stop_loss_pct / 100.0
            
            total_rows = len(df)
            self.progress_bar.setRange(0, total_rows)
            self.progress_bar.setValue(0)
            self.progress_bar.setVisible(True)
            self.statusBar.showMessage("라벨링 분석 연산 중...")
            
            # 미래 데이터를 훑어보며 조건 시뮬레이션
            for i in range(total_rows):
                if i % 250 == 0:
                    self.progress_bar.setValue(i)
                    QApplication.processEvents()
                    
                entry_price = opens[i]
                long_target = entry_price * (1 + tp)
                long_stop = entry_price * (1 - sl)
                short_target = entry_price * (1 - tp)
                short_stop = entry_price * (1 + sl)
                
                long_hit_idx = -1
                short_hit_idx = -1
                
                for j in range(i + 1, len(df)):
                    curr_high = highs[j]
                    curr_low = lows[j]
                    
                    if long_hit_idx == -1:
                        if curr_low <= long_stop:
                            long_hit_idx = -2 # 먼저 손절에 도달
                        elif curr_high >= long_target:
                            long_hit_idx = j # 정상 익절
                            
                    if short_hit_idx == -1:
                        if curr_high >= short_stop:
                            short_hit_idx = -2
                        elif curr_low <= short_target:
                            short_hit_idx = j
                            
                    if long_hit_idx != -1 and short_hit_idx != -1:
                        break
                        
                is_long_success = (long_hit_idx >= 0)
                is_short_success = (short_hit_idx >= 0)
                
                if is_long_success and not is_short_success:
                    labels[i] = 1
                elif is_short_success and not is_long_success:
                    labels[i] = -1
                elif is_long_success and is_short_success:
                    # 둘 다 목표 도달 시, '먼저' 달성한 진입포지션을 선택
                    if long_hit_idx < short_hit_idx:
                        labels[i] = 1
                    elif short_hit_idx < long_hit_idx:
                        labels[i] = -1
                    else:
                        labels[i] = 0
                else:
                    labels[i] = 0

            self.progress_bar.setValue(total_rows)
            QApplication.processEvents()

            df['ls_label'] = labels
            df.to_csv(cache_file, index=False)
            
            self.progress_bar.setVisible(False)
            self.statusBar.showMessage("라벨링 완료!", 3000)
            
            QMessageBox.information(self, "라벨링 완료", "설정한 비율에 따라 라벨링 작업이 완료되었습니다.")
            
            # 기존 화면에 표시 중이던 기간이 있다면 그 구간을 다시 새로고침하여 표 갱신
            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)
                
        except Exception as e:
            QMessageBox.critical(self, "오류", f"라벨링 중 예기치 않은 오류 발생: {str(e)}")
            
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")
            self.progress_bar.setVisible(False)
            self.statusBar.clearMessage()

    def apply_deep_learning_labeling(self):
        import os
        import json
        import torch
        import numpy as np
        import pandas as pd
        
        model_path = 'trading_model.pth'
        scaler_path = 'scaler_config.json'
        cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
        
        if not os.path.exists(model_path) or not os.path.exists(scaler_path):
            QMessageBox.warning(self, "오류", "학습된 모델 파일(trading_model.pth) 또는 스케일러 설정(scaler_config.json)을 찾을 수 없습니다.\n먼저 터미널에서 'python train.py'를 실행하여 모델을 학습시켜 주세요.")
            return
            
        if not os.path.exists(cache_file):
            QMessageBox.warning(self, "오류", "현재 타임프레임의 캐시 파일이 없습니다. 데이터를 먼저 다운로드하세요.")
            return
            
        self.setWindowTitle("Binance Futures BTC - 딥러닝 예측 중...")
        self.statusBar.showMessage("딥러닝 모델 예측 연산 중...")
        QApplication.processEvents()
        
        def calculate_rsi(series, period=14):
            delta = series.diff()
            gain = delta.clip(lower=0)
            loss = -delta.clip(upper=0)
            avg_gain = gain.ewm(alpha=1/period, adjust=False).mean()
            avg_loss = loss.ewm(alpha=1/period, adjust=False).mean()
            rs = avg_gain / (avg_loss + 1e-9)
            return 100 - (100 / (1 + rs))

        def calculate_atr(df_in, period=14):
            high = df_in['high']
            low = df_in['low']
            close = df_in['close']
            prev_close = close.shift(1)
            tr = pd.concat([
                high - low,
                (high - prev_close).abs(),
                (low - prev_close).abs()
            ], axis=1).max(axis=1)
            return tr.ewm(alpha=1/period, adjust=False).mean()
            
        try:
            # 1. 스케일러 설정 로드
            with open(scaler_path, 'r', encoding='utf-8') as f:
                scaler_config = json.load(f)
            mean = np.array(scaler_config['mean'])
            std = np.array(scaler_config['std'])
            feature_cols = scaler_config['feature_cols']
            
            # 2. 데이터 로드 및 피처 계산
            df = pd.read_csv(cache_file)
            df = df.sort_values('timestamp').reset_index(drop=True)
            
            df_feats = df.copy()
            df_feats['close_prev'] = df_feats['close'].shift(1)
            df_feats['open_pct'] = (df_feats['open'] / df_feats['close_prev']) - 1.0
            df_feats['high_pct'] = (df_feats['high'] / df_feats['close_prev']) - 1.0
            df_feats['low_pct'] = (df_feats['low'] / df_feats['close_prev']) - 1.0
            df_feats['close_pct'] = (df_feats['close'] / df_feats['close_prev']) - 1.0
            
            for p in [20, 50, 100]:
                df_feats[f'sma_{p}_ratio'] = (df_feats['close'] / df_feats['close'].rolling(p).mean()) - 1.0
                
            df_feats['rsi_14'] = calculate_rsi(df_feats['close'], 14) / 100.0 - 0.5
            
            macd_val, macd_sig, macd_hist = self.calculate_macd(df_feats['close'], 12, 26, 9)
            df_feats['macd_ratio'] = macd_val / df_feats['close']
            df_feats['macd_sig_ratio'] = macd_sig / df_feats['close']
            df_feats['macd_hist_ratio'] = macd_hist / df_feats['close']
            
            df_feats['atr_ratio'] = calculate_atr(df_feats, 14) / df_feats['close']
            df_feats['vol_ratio'] = (df_feats['volume'] / (df_feats['volume'].rolling(20).mean() + 1e-9)) - 1.0
            
            # 3. 피처 정형화 및 슬라이딩 윈도우 구성
            features = df_feats[feature_cols].values
            seq_len = 60
            labels = np.zeros(len(df), dtype=int)
            
            nan_mask = np.isnan(features).any(axis=1)
            first_valid_idx = np.where(~nan_mask)[0][0] if not nan_mask.all() else len(df)
            start_idx = max(first_valid_idx + seq_len, seq_len)
            
            if start_idx < len(df):
                X_list = []
                for i in range(start_idx, len(df)):
                    window = features[i - seq_len : i]
                    window_scaled = (window - mean) / std
                    X_list.append(window_scaled)
                X_batch = np.array(X_list)
                
                # 4. PyTorch 모델 추론
                from train import TradingCNNLSTM
                device = 'cuda' if torch.cuda.is_available() else 'cpu'
                
                model = TradingCNNLSTM(input_dim=len(feature_cols), hidden_dim=64, num_classes=3)
                model.load_state_dict(torch.load(model_path, map_location=device))
                model = model.to(device)
                model.eval()
                
                X_tensor = torch.FloatTensor(X_batch).to(device)
                
                preds_all = []
                batch_size = 256
                with torch.no_grad():
                    for offset in range(0, len(X_tensor), batch_size):
                        batch_x = X_tensor[offset : offset + batch_size]
                        outputs = model(batch_x)
                        _, predicted = outputs.max(1)
                        preds_all.extend(predicted.cpu().numpy())
                        
                # 예측 라벨 맵핑 (0, 1, 2 -> -1, 0, 1)
                preds_mapped = np.array(preds_all) - 1
                labels[start_idx:] = preds_mapped
                
            df['ls_label'] = labels
            df.to_csv(cache_file, index=False)
            
            long_count = (labels == 1).sum()
            short_count = (labels == -1).sum()
            
            QMessageBox.information(self, "예측 완료", 
                                    f"딥러닝 예측 라벨링 완료!\n"
                                    f"Long: {long_count}개, Short: {short_count}개\n"
                                    f"(최초 {start_idx}개 데이터는 과거 데이터 부족으로 0으로 설정되었습니다.)")
                                    
            if hasattr(self, 'last_start_ms') and hasattr(self, 'last_end_ms'):
                self.download_data(self.last_start_ms, self.last_end_ms, self.current_timeframe)
                
        except Exception as e:
            QMessageBox.critical(self, "오류", f"딥러닝 모델 예측 중 오류 발생: {str(e)}")
        finally:
            self.setWindowTitle("Binance Futures BTC OHLCV Downloader")
            self.statusBar.clearMessage()

    def run_backtest(self):
        if not hasattr(self, 'current_df') or self.current_df.empty:
            QMessageBox.warning(self, "백테스트", "백테스트를 수행할 데이터가 없습니다.")
            return

        dialog = BacktestDialog(self)
        if not dialog.exec():
            return
            
        leverage, save_csv = dialog.get_settings()

        import os
        try:
            # 규칙 1: capital 100으로 초기화
            df = self.current_df.copy()
            df['capital'] = 100.0
            fee_rate = 0.0005  # 0.05%
            balance = 100.0
            pos = 0          # 0: 없음, 1: Long, -1: Short
            entry_price = 0.0
            entry_time = None
            balance_before = 100.0
            entry_fee = 0.0
            trade_margin = 0.0
            
            trade_history = []
            trade_highest = 0.0
            trade_lowest = 0.0

            total_rows = len(df)

            # 규칙 2~6: 봉 단위 가상 거래 시뮬레이션
            for i in range(total_rows):
                label      = int(df.iloc[i - 1]['ls_label']) if i > 0 else 0
                open_price = float(df.iloc[i]['open'])
                current_time = df.iloc[i]['timestamp']

                # 규칙 5-4: 현재 포지션과 다른 label이 나타나면 청산만 수행
                if pos != 0 and label != pos:
                    if pos == 1:
                        pnl_raw = (open_price - entry_price) / entry_price
                        max_profit_pct = (trade_highest - entry_price) / entry_price * 100 * leverage
                        max_loss_pct = (trade_lowest - entry_price) / entry_price * 100 * leverage
                    else:  # pos == -1
                        pnl_raw = (entry_price - open_price) / entry_price
                        max_profit_pct = (entry_price - trade_lowest) / entry_price * 100 * leverage
                        max_loss_pct = (entry_price - trade_highest) / entry_price * 100 * leverage
                        
                    pnl_amount = trade_margin * leverage * pnl_raw
                    nominal_close_size = trade_margin * leverage + pnl_amount
                    if nominal_close_size < 0: nominal_close_size = 0
                    exit_fee = nominal_close_size * fee_rate
                    
                    balance += pnl_amount
                    balance -= exit_fee
                    if balance < 0: balance = 0
                    
                    total_fee = entry_fee + exit_fee
                    pnl_leveraged = pnl_amount / trade_margin if trade_margin > 0 else 0
                    
                    trade_history.append({
                        "롱/숏 포지션": "Long" if pos == 1 else "Short",
                        "레버리지": leverage,
                        "진입 시간": entry_time,
                        "청산 시간": current_time,
                        "진입 가격": entry_price,
                        "청산 가격": open_price,
                        "pnl": pnl_leveraged,
                        "roe": pnl_leveraged * 100,
                        "거래 수수료": total_fee,
                        "거래전 자산": balance_before,
                        "거래 후 자산": balance,
                        "최대 손실 (%)": max_loss_pct,
                        "최대 이익 (%)": max_profit_pct
                    })
                    pos = 0

                # 규칙 5-2/5-3: 포지션이 없고 label이 있으면 진입
                if pos == 0 and label != 0:
                    pos = label
                    entry_price = open_price
                    entry_time = current_time
                    balance_before = balance
                    
                    nominal_size = balance * leverage
                    entry_fee = nominal_size * fee_rate
                    balance -= entry_fee
                    trade_margin = balance
                    
                    curr_high = float(df.iloc[i]['high'])
                    curr_low = float(df.iloc[i]['low'])
                    trade_highest = curr_high
                    trade_lowest = curr_low
                elif pos != 0:
                    # 포지션 유지중인 경우 현재 봉의 high/low 반영
                    curr_high = float(df.iloc[i]['high'])
                    curr_low = float(df.iloc[i]['low'])
                    if curr_high > trade_highest:
                        trade_highest = curr_high
                    if curr_low < trade_lowest:
                        trade_lowest = curr_low

                # 규칙 5-5: 마지막 봉에 포지션이 남아 있으면 close로 청산
                if i == total_rows - 1 and pos != 0:
                    close_price = float(df.iloc[i]['close'])
                    if pos == 1:
                        pnl_raw = (close_price - entry_price) / entry_price
                        max_profit_pct = (trade_highest - entry_price) / entry_price * 100 * leverage
                        max_loss_pct = (trade_lowest - entry_price) / entry_price * 100 * leverage
                    else:
                        pnl_raw = (entry_price - close_price) / entry_price
                        max_profit_pct = (entry_price - trade_lowest) / entry_price * 100 * leverage
                        max_loss_pct = (entry_price - trade_highest) / entry_price * 100 * leverage
                        
                    pnl_amount = trade_margin * leverage * pnl_raw
                    nominal_close_size = trade_margin * leverage + pnl_amount
                    if nominal_close_size < 0: nominal_close_size = 0
                    exit_fee = nominal_close_size * fee_rate
                    
                    balance += pnl_amount
                    balance -= exit_fee
                    if balance < 0: balance = 0
                    
                    total_fee = entry_fee + exit_fee
                    pnl_leveraged = pnl_amount / trade_margin if trade_margin > 0 else 0
                    
                    trade_history.append({
                        "롱/숏 포지션": "Long" if pos == 1 else "Short",
                        "레버리지": leverage,
                        "진입 시간": entry_time,
                        "청산 시간": current_time,
                        "진입 가격": entry_price,
                        "청산 가격": close_price,
                        "pnl": pnl_leveraged,
                        "roe": pnl_leveraged * 100,
                        "거래 수수료": total_fee,
                        "거래전 자산": balance_before,
                        "거래 후 자산": balance,
                        "최대 손실 (%)": max_loss_pct,
                        "최대 이익 (%)": max_profit_pct
                    })
                    pos = 0

                # 규칙 6: 매 봉 capital 기록
                df.at[i, 'capital'] = balance

            # 3. 결과 저장 (캐시 파일 업데이트)
            cache_file = TIMEFRAME_CONFIG[self.current_timeframe]['cache']
            if os.path.exists(cache_file):
                full_cache = pd.read_csv(cache_file)
                
                # KST(UTC+9)이므로 9시간을 빼고 ms로 변환
                df_to_save = df.copy()
                df_to_save['timestamp_ms'] = (pd.to_datetime(df_to_save['timestamp']) - pd.Timedelta(hours=9)).values.astype(np.int64) // 10**6
                
                # full_cache의 해당 timestamp 행들의 capital 업데이트
                full_cache.set_index('timestamp', inplace=True)
                updates = df_to_save.set_index('timestamp_ms')['capital']
                full_cache.update(updates.to_frame())
                full_cache.reset_index(inplace=True)
                full_cache.to_csv(cache_file, index=False)
            
            if save_csv and trade_history:
                history_df = pd.DataFrame(trade_history)
                timestamp_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                history_file = f"backtest_history_{timestamp_str}.csv"
                history_df.to_csv(history_file, index=False, encoding='utf-8-sig')
            
            # 4. UI 갱신 (테이블 등)
            self.populate_ui(df)
            
            final_capital = df.iloc[-1]['capital']
            roi = (final_capital - 100.0)
            
            msg = f"백테스트가 완료되었습니다.\n최종 자산: {final_capital:.2f} USDT\n수익률: {roi:.2f}%"
            if save_csv and trade_history:
                msg += f"\n\n거래 내역이 '{history_file}'에 저장되었습니다."
                
            QMessageBox.information(self, "백테스트 완료", msg)
            
        except Exception as e:
            QMessageBox.critical(self, "오류", f"백테스트 중 오류 발생: {str(e)}")

    def open_download_dialog(self):
        start_str = None
        end_str = None
        
        # 현재 화면(차트 및 표)에 표시 중인 데이터가 있다면 그 시작과 끝 시간을 가져옵니다.
        if hasattr(self, 'current_df') and not self.current_df.empty:
            start_str = self.current_df['timestamp'].iloc[0].strftime('%Y-%m-%d %H:%M:%S')
            end_str = self.current_df['timestamp'].iloc[-1].strftime('%Y-%m-%d %H:%M:%S')
            
        # 메뉴에서 데이터 다운로드를 클릭했을 때 뜨는 작은 창(Dialog)에 현재 시간 및 타임프레임 전달
        dialog = DownloadDialog(self, start_str=start_str, end_str=end_str,
                                timeframe=self.current_timeframe)
        if dialog.exec():
            # 다이얼로그에서 설정한 시간/타임프레임을 바탕으로 다운로드 함수 호출
            start_ms, end_ms, tf_key = dialog.get_dates()
            self.current_timeframe = tf_key
            self.download_data(start_ms, end_ms, tf_key)
            
    def setup_views(self):
        # Create Vertical Splitter
        self.splitter = QSplitter(Qt.Vertical)
        self.layout.addWidget(self.splitter)
        
        # Top: Chart
        self.chart_widget = QWidget()
        self.chart_layout = QVBoxLayout(self.chart_widget)
        self.chart_layout.setContentsMargins(0, 0, 0, 0)
        self.fig = Figure()
        self.canvas = FigureCanvas(self.fig)
        
        # 차트 이동/저장을 돕는 툴바 
        self.toolbar = NavigationToolbar(self.canvas, self)
        self.chart_layout.addWidget(self.toolbar)
        
        self.chart_layout.addWidget(self.canvas)
        self.splitter.addWidget(self.chart_widget)
        
        # 마우스 커스텀 이벤트(스크롤, 이동, 더블클릭) 이벤트 연결
        self._dragging = False
        self.canvas.mpl_connect('scroll_event', self.zoom_chart)
        self.canvas.mpl_connect('button_press_event', self.on_press)
        self.canvas.mpl_connect('motion_notify_event', self.on_motion)
        self.canvas.mpl_connect('button_release_event', self.on_release)
        
        # Bottom: Table
        self.table = QTableWidget()
        self.table.setColumnCount(8)
        self.table.setHorizontalHeaderLabels(["시간 (Timestamp)", "시가 (Open)", "고가 (High)", "저가 (Low)", "종가 (Close)", "거래량 (Volume)", "LS Label", "자산 (Capital)"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.splitter.addWidget(self.table)
        
        # 표 더블클릭 이벤트 연결 (차트 동기화)
        self.table.itemDoubleClicked.connect(self.on_table_double_click)
        
        # Set Default Splitter Ratio (e.g., 60% chart, 40% table)
        self.splitter.setSizes([500, 300])
        
    def download_data(self, start_ms=None, end_ms=None, timeframe=None, quiet=False):
        if timeframe is None:
            timeframe = self.current_timeframe

        tf_cfg = TIMEFRAME_CONFIG[timeframe]
        tf_ms   = tf_cfg['ms']       # 한 캔들의 ms 간격
        tf_ccxt = tf_cfg['ccxt']     # ccxt용 문자열
        cache_file = tf_cfg['cache'] # 타임프레임별 캐시 파일

        if start_ms is None or end_ms is None:
            # 기본 설정값 (프로그램 최초 실행 시 자동 다운로드용)
            start_ms = QDateTime.fromString("2025-07-22 00:00:00", "yyyy-MM-dd HH:mm:ss").toMSecsSinceEpoch()
            end_ms = QDateTime.fromString("2025-07-23 23:59:00", "yyyy-MM-dd HH:mm:ss").toMSecsSinceEpoch()
            
        if start_ms >= end_ms:
            if not quiet:
                QMessageBox.warning(self, "잘못된 입력", "시작 시간은 종료 시간보다 빨라야 합니다.")
            return False
            
        if not quiet:
            # UI를 새로고침(또는 라벨링 후 갱신)할 때 기존 구간을 재사용하기 위해 저장
            self.last_start_ms = start_ms
            self.last_end_ms = end_ms
            self.current_timeframe = timeframe
            
        # UI 업데이트 강제 (모달 창 처리)
        QApplication.processEvents() 
        
        try:
            exchange = ccxt.binance({'options': {'defaultType': 'future'}})
            symbol = 'BTC/USDT'
            limit = 1500
            
            import os
            if os.path.exists(cache_file):
                df_cache = pd.read_csv(cache_file)
                if 'ls_label' not in df_cache.columns:
                    df_cache['ls_label'] = 0
                if 'capital' not in df_cache.columns:
                    df_cache['capital'] = 100.0
            else:
                df_cache = pd.DataFrame(columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'ls_label', 'capital'])
                
            # 다운로드해야 할 구간 (Intervals) 선별: 빠진 구간(Hole) 찾기 알고리즘
            fetch_intervals = []
            
            # 요청한 시간 범위에서 있어야 할 타임프레임 단위 전체 타임스탬프 집합
            expected_ts = set(range(start_ms, end_ms, tf_ms))
            if not df_cache.empty:
                existing_ts = set(df_cache['timestamp'])
                # 로컬 캐시에 존재하지 않는 타임스탬프만 필터링하여 정렬
                missing_ts = sorted(list(expected_ts - existing_ts))
            else:
                # 캐시가 빈 경우 전체가 누락됨
                missing_ts = sorted(list(expected_ts))
                
            if missing_ts:
                # 누락된 타임스탬프들을 연속된 구간(Interval)으로 그룹화
                s_idx = 0
                for i in range(1, len(missing_ts) + 1):
                    # 다음 인덱스가 배열 끝이거나, 간격이 한 캔들을 초과(연속되지 않음)하는 경우 끊습니다.
                    if i == len(missing_ts) or missing_ts[i] - missing_ts[i-1] > tf_ms:
                        f_start = missing_ts[s_idx]
                        f_end = missing_ts[i-1] + tf_ms
                        fetch_intervals.append((f_start, f_end))
                        s_idx = i
            
            new_ohlcv = []
            for f_start, f_end in fetch_intervals:
                current_start = f_start
                while current_start < f_end:
                    try:
                        ohlcv = exchange.fetch_ohlcv(symbol, tf_ccxt, since=current_start, limit=limit)
                        if not ohlcv:
                            break
                            
                        # 목표 구간 (f_end)을 넘지 않도록 필터링
                        filtered = [row for row in ohlcv if row[0] <= f_end]
                        if not filtered:
                            break
                            
                        new_ohlcv.extend(filtered)
                        
                        last_ts = ohlcv[-1][0]
                        if current_start == last_ts:
                            break
                        current_start = last_ts + 1
                    except Exception as e:
                        if not quiet:
                            QMessageBox.warning(self, "API 오류", f"데이터를 가져오는 중 오류가 발생했습니다: {str(e)}")
                        else:
                            print(f"Quiet download API error: {e}")
                        break
            
            # 새로 받은 데이터가 있으면 캐시에 병합
            if new_ohlcv:
                df_new = pd.DataFrame(new_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                df_new['ls_label'] = 0
                df_new['capital'] = 100.0
                df_cache = pd.concat([df_cache, df_new], ignore_index=True)
                
            if not df_cache.empty:
                # 중복 데이터 제거 및 정렬 후 파일로 저장
                df_cache.drop_duplicates(subset=['timestamp'], inplace=True)
                df_cache.sort_values('timestamp', inplace=True)
                df_cache.to_csv(cache_file, index=False)
                
                # 사용자가 요청한 범위에 해당하는 데이터만 추출하여 표시
                display_df = df_cache[(df_cache['timestamp'] >= start_ms) & (df_cache['timestamp'] <= end_ms)].copy()
                
                if not quiet:
                    if not display_df.empty:
                        # 바이낸스 기본 시간은 세계 표준시(UTC)이므로, 대한민국 표준시(KST, UTC+9)로 변환
                        display_df['timestamp'] = pd.to_datetime(display_df['timestamp'], unit='ms') + pd.Timedelta(hours=9)
                        self.populate_ui(display_df)
                    else:
                        QMessageBox.information(self, "데이터 없음", "선택한 기간 동안의 데이터가 없습니다.")
            else:
                if not quiet:
                    QMessageBox.information(self, "데이터 없음", "캐시가 비어있고 데이터를 받아오지 못했습니다.")
                    
            # 활성화된 다중 타임프레임 MACD 설정이 있다면 해당 대상 시간틀 데이터도 자동으로 받아두기
            if not quiet and hasattr(self, 'mtf_macd_settings') and self.mtf_macd_settings:
                for (tf_key, fast_len, slow_len, sig_len) in self.mtf_macd_settings:
                    if tf_key != timeframe:
                        warmup_bars = (slow_len + sig_len) * 4
                        target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
                        start_download_ms = start_ms - (target_ms * warmup_bars)
                        end_download_ms = end_ms
                        self.download_data(start_download_ms, end_download_ms, timeframe=tf_key, quiet=True)

            # 활성화된 칼만 MTF MACD 설정이 있다면 해당 대상 시간틀 데이터도 자동으로 받아두기
            if not quiet and hasattr(self, 'kalman_mtf_macd_settings') and self.kalman_mtf_macd_settings:
                for (tf_key, Q, R, fast_len, slow_len, sig_len) in self.kalman_mtf_macd_settings:
                    if tf_key != timeframe:
                        warmup_bars = (slow_len + sig_len) * 4
                        target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
                        start_download_ms = start_ms - (target_ms * warmup_bars)
                        end_download_ms = end_ms
                        self.download_data(start_download_ms, end_download_ms, timeframe=tf_key, quiet=True)

            # 활성화된 MTF Stoch RSI 설정이 있다면 해당 대상 시간틀 데이터도 자동으로 받아두기
            if not quiet and hasattr(self, 'mtf_stoch_rsi_settings') and self.mtf_stoch_rsi_settings:
                for (tf_key, rsi_len, stoch_len, k_len, d_len, ob_level, os_level) in self.mtf_stoch_rsi_settings:
                    if tf_key != timeframe:
                        warmup_bars = max(rsi_len, stoch_len, k_len, d_len) * 4
                        target_ms = TIMEFRAME_CONFIG[tf_key]['ms']
                        start_download_ms = start_ms - (target_ms * warmup_bars)
                        end_download_ms = end_ms
                        self.download_data(start_download_ms, end_download_ms, timeframe=tf_key, quiet=True)
                
        except Exception as e:
            if not quiet:
                QMessageBox.critical(self, "오류", f"예기치 않은 오류가 발생했습니다: {str(e)}")
            else:
                print(f"Quiet download error: {e}")
            return False
        return True
            
    def populate_ui(self, df):
        # 1. Populate Table
        # 필터링된 데이터프레임의 기존 인덱스를 0부터 시작하도록 리셋해야 QTableWidget 행 번호와 일치합니다.
        df = df.reset_index(drop=True)
        self.current_df = df  # 더블클릭 이벤트를 위해 데이터 보관
        self.table.setRowCount(len(df))
        for row_idx, row in df.iterrows():
            ts_item = QTableWidgetItem(row['timestamp'].strftime('%Y-%m-%d %H:%M'))
            ts_item.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled)
            self.table.setItem(row_idx, 0, ts_item)
            
            for col_idx, col_name in enumerate(['open', 'high', 'low', 'close', 'volume']):
                item = QTableWidgetItem(f"{row[col_name]:.2f}")
                item.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled)
                self.table.setItem(row_idx, col_idx + 1, item)
                
            # LS Label 열 표시
            ls_item = QTableWidgetItem(str(int(row.get('ls_label', 0))))
            ls_item.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled)
            self.table.setItem(row_idx, 6, ls_item)
            
            # Capital (자산) 열 표시
            capital_val = row.get('capital', 100.0)
            cap_item = QTableWidgetItem(f"{capital_val:.2f}")
            cap_item.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled)
            self.table.setItem(row_idx, 7, cap_item)
                
        # 2. Draw Candlestick Chart
        self.fig.clear()
        
        plot_df = df.copy()
        plot_df.set_index('timestamp', inplace=True)
        # Ensure data types are float for mplfinance
        for col in ['open', 'high', 'low', 'close', 'volume']:
            plot_df[col] = plot_df[col].astype(float)
            
        # 활성화된 서브 차트 패널 조사
        has_slope = bool(self.ma_slope_settings)
        has_sqz = bool(self.squeeze_settings)
        has_wt = bool(self.wavetrend_settings)
        has_macd = bool(self.mtf_macd_settings)
        has_kalman_macd = bool(self.kalman_mtf_macd_settings)
        has_stoch_rsi = bool(self.mtf_stoch_rsi_settings)
        
        total_panels = 1
        height_ratios = [3]
        if has_slope:
            total_panels += 1
            height_ratios.append(1)
        if has_sqz:
            total_panels += 1
            height_ratios.append(1)
        if has_wt:
            total_panels += 1
            height_ratios.append(1)
        if has_macd:
            total_panels += 1
            height_ratios.append(1)
        if has_kalman_macd:
            total_panels += 1
            height_ratios.append(1)
        if has_stoch_rsi:
            total_panels += 1
            height_ratios.append(1)
            
        from matplotlib.gridspec import GridSpec
        gs = GridSpec(total_panels, 1, figure=self.fig, height_ratios=height_ratios, hspace=0.08)
        
        current_panel_idx = 0
        ax = self.fig.add_subplot(gs[current_panel_idx])
        current_panel_idx += 1
        
        if has_slope:
            ax_slope = self.fig.add_subplot(gs[current_panel_idx], sharex=ax)
            current_panel_idx += 1
        else:
            ax_slope = None
            
        if has_sqz:
            ax_sqz = self.fig.add_subplot(gs[current_panel_idx], sharex=ax)
            current_panel_idx += 1
        else:
            ax_sqz = None
            
        if has_wt:
            ax_wt = self.fig.add_subplot(gs[current_panel_idx], sharex=ax)
            current_panel_idx += 1
        else:
            ax_wt = None
            
        if has_macd:
            ax_macd = self.fig.add_subplot(gs[current_panel_idx], sharex=ax)
            current_panel_idx += 1
        else:
            ax_macd = None

        if has_kalman_macd:
            ax_kalman_macd = self.fig.add_subplot(gs[current_panel_idx], sharex=ax)
            current_panel_idx += 1
        else:
            ax_kalman_macd = None

        if has_stoch_rsi:
            ax_stoch_rsi = self.fig.add_subplot(gs[current_panel_idx], sharex=ax)
            current_panel_idx += 1
        else:
            ax_stoch_rsi = None

        # 한국인에게 친숙한 색상 (상승: 빨강, 하락: 파랑)
        mc = mpf.make_marketcolors(up='red', down='blue', edge='inherit', wick='inherit')
        style = mpf.make_mpf_style(marketcolors=mc)
        
        import matplotlib.dates as mdates
        import numpy as np
        
        addplots = []
        
        # SMA 렌더링
        sma_colors = ['orange', 'purple', 'green', 'magenta', 'cyan', 'brown']
        if hasattr(self, 'sma_periods') and self.sma_periods:
            for idx, period in enumerate(self.sma_periods):
                col_name = f'SMA_{period}'
                plot_df[col_name] = plot_df['close'].rolling(window=period).mean()
                color = sma_colors[idx % len(sma_colors)]
                addplots.append(mpf.make_addplot(plot_df[col_name], type='line', color=color, width=1.0, ax=ax))

        # 슈퍼트렌드 렌더링 (상승: 초록, 하락: 빨강)
        st_bull_colors = ['#00c853', '#00897b', '#1565c0']  # 3개 각각 구분 색
        st_bear_colors = ['#d50000', '#ff6d00', '#aa00ff']
        if hasattr(self, 'supertrend_settings') and self.supertrend_settings:
            raw_vals = plot_df[['open', 'high', 'low', 'close']].copy().reset_index(drop=True)
            for st_idx, (atr_period, multiplier) in enumerate(self.supertrend_settings):
                st_line, direction = self.calculate_supertrend(raw_vals, atr_period, multiplier)
                bull_arr = np.where(direction == 1, st_line, np.nan)
                bear_arr = np.where(direction == -1, st_line, np.nan)
                bull_series = pd.Series(bull_arr, index=plot_df.index)
                bear_series = pd.Series(bear_arr, index=plot_df.index)
                if not np.isnan(bull_arr).all():
                    addplots.append(mpf.make_addplot(bull_series, type='line',
                                                     color=st_bull_colors[st_idx % 3], width=1.5, ax=ax))
                if not np.isnan(bear_arr).all():
                    addplots.append(mpf.make_addplot(bear_series, type='line',
                                                     color=st_bear_colors[st_idx % 3], width=1.5, ax=ax))

        # Hull Suite 렌더링 (상승: 초록, 하락: 빨강)
        if hasattr(self, 'hull_suite_settings') and self.hull_suite_settings:
            for length in self.hull_suite_settings:
                hma = self.calculate_hma(plot_df['close'], length)
                prev_hma = hma.shift(1)
                hma_bull = np.where(hma > prev_hma, hma, np.nan)
                hma_bear = np.where(hma < prev_hma, hma, np.nan)
                if not np.isnan(hma_bull).all():
                    addplots.append(mpf.make_addplot(pd.Series(hma_bull, index=plot_df.index), type='line',
                                                     color='#00c853', width=2.0, ax=ax))
                if not np.isnan(hma_bear).all():
                    addplots.append(mpf.make_addplot(pd.Series(hma_bear, index=plot_df.index), type='line',
                                                     color='#d50000', width=2.0, ax=ax))

        if hasattr(self, 'show_label_action') and self.show_label_action.isChecked() and 'ls_label' in plot_df.columns:
            offset = plot_df['close'] * 0.0005
            
            long_arr = np.where(plot_df['ls_label'] == 1, plot_df['high'] + offset, np.nan)
            short_arr = np.where(plot_df['ls_label'] == -1, plot_df['low'] - offset, np.nan)
            
            if not np.isnan(long_arr).all():
                # 봉 위에 위쪽 화살표 상승기호(빨간색)
                addplots.append(mpf.make_addplot(long_arr, type='scatter', markersize=0.6, marker='^', color='red', ax=ax))
            if not np.isnan(short_arr).all():
                # 봉 아래쪽에 아래쪽 화살표 하락기호(파란색)
                addplots.append(mpf.make_addplot(short_arr, type='scatter', markersize=0.6, marker='v', color='blue', ax=ax))
                
        # show_nontrading=True 설정으로 X축을 실제 datetime으로 사용하여 matplotlib 포매터 적용
        tf_label = TIMEFRAME_CONFIG[self.current_timeframe]['label']
        chart_title = f"BTC/USDT {tf_label} (Binance Futures)"
        if addplots:
            mpf.plot(plot_df, type='candle', ax=ax, style=style, xrotation=0, show_nontrading=True, axtitle=chart_title, ylabel="Price (USDT)", addplot=addplots)
        else:
            mpf.plot(plot_df, type='candle', ax=ax, style=style, xrotation=0, show_nontrading=True, axtitle=chart_title, ylabel="Price (USDT)")

        x_nums = mdates.date2num(plot_df.index.to_pydatetime())
        # bar_width 계산
        bar_width = 0.6 * np.diff(x_nums).mean() if len(x_nums) > 1 else 0.0005

        # MA Slope 패널 렌더링
        if ax_slope is not None:
            slope_line_colors = ['#2196f3', '#ff9800', '#9c27b0']
            ax_slope.axhline(y=0, color='#888888', linewidth=0.8, linestyle='-')
            for idx, (ma_type, ma_period, lookback) in enumerate(self.ma_slope_settings):
                if ma_type == 'EMA':
                    ma_series = plot_df['close'].ewm(span=ma_period, adjust=False).mean()
                else:  # SMA
                    ma_series = plot_df['close'].rolling(window=ma_period).mean()
                slope = ma_series - ma_series.shift(lookback)
                slope_vals = slope.values
                color = slope_line_colors[idx % len(slope_line_colors)]
                ax_slope.plot(x_nums, slope_vals, color=color, linewidth=1.0,
                              label=f'{ma_type}({ma_period}) Slope({lookback})')
                valid = ~np.isnan(slope_vals)
                ax_slope.fill_between(x_nums, slope_vals, 0,
                                      where=valid & (slope_vals >= 0),
                                      color='#00c853', alpha=0.3, interpolate=True)
                ax_slope.fill_between(x_nums, slope_vals, 0,
                                      where=valid & (slope_vals < 0),
                                      color='#d50000', alpha=0.3, interpolate=True)
            ax_slope.set_ylabel('MA Slope', fontsize=8)
            ax_slope.legend(fontsize=7, loc='upper left')
            ax_slope.grid(axis='both', linestyle='--', linewidth=0.4, alpha=0.6)

        # Squeeze Momentum 패널 렌더링
        if ax_sqz is not None:
            for (bb_len, bb_mult, kc_len, kc_mult) in self.squeeze_settings:
                sqz_val, sqzOn, sqzOff = self.calculate_squeeze_momentum(plot_df, bb_len, bb_mult, kc_len, kc_mult)
                sqz_val_arr = sqz_val.values
                colors = []
                for i in range(len(sqz_val_arr)):
                    val = sqz_val_arr[i]
                    if np.isnan(val):
                        colors.append('#888888')
                        continue
                    prev_val = sqz_val_arr[i-1] if i > 0 else 0
                    if val > 0:
                        colors.append('#26a69a' if val > prev_val else '#b2dfdb')
                    else:
                        colors.append('#ef5350' if val < prev_val else '#ffcdd2')
                
                ax_sqz.bar(x_nums, sqz_val_arr, width=bar_width, color=colors, align='center', alpha=0.8)
                
                dot_y = np.zeros(len(sqz_val_arr))
                ax_sqz.scatter(x_nums[sqzOn], dot_y[sqzOn], color='#ff1100', s=10, marker='o', label='Squeeze ON')
                ax_sqz.scatter(x_nums[sqzOff], dot_y[sqzOff], color='#00e676', s=10, marker='o', label='Squeeze OFF')
                
                ax_sqz.axhline(y=0, color='#888888', linewidth=0.5)
                ax_sqz.set_ylabel('Sqz Mom', fontsize=8)
                ax_sqz.grid(axis='both', linestyle='--', linewidth=0.4, alpha=0.6)

        # WaveTrend 패널 렌더링
        if ax_wt is not None:
            for setting in self.wavetrend_settings:
                if len(setting) == 6:
                    ch_len, avg_len, wt2_len, ob_level, os_level, cross_count = setting
                else:
                    ch_len, avg_len, wt2_len, ob_level, os_level = setting
                    cross_count = 1
                wt1, wt2 = self.calculate_wavetrend(plot_df, ch_len, avg_len, wt2_len)
                ax_wt.plot(x_nums, wt1.values, color='#00e676', linewidth=1.2, label='WT1')
                ax_wt.plot(x_nums, wt2.values, color='#ff3d00', linewidth=1.2, linestyle='--', label='WT2')
                
                ax_wt.axhline(y=ob_level, color='#ff1744', linestyle=':', linewidth=0.8, alpha=0.7)
                ax_wt.axhline(y=os_level, color='#00e676', linestyle=':', linewidth=0.8, alpha=0.7)
                ax_wt.axhline(y=0, color='#888888', linestyle='-', linewidth=0.5, alpha=0.5)
                
                valid = ~np.isnan(wt1.values) & ~np.isnan(wt2.values)
                ax_wt.fill_between(x_nums, wt1.values, wt2.values, where=valid, color='#2196f3', alpha=0.15)
                
                ax_wt.set_ylabel('WaveTrend', fontsize=8)
                ax_wt.legend(fontsize=7, loc='upper left')
                ax_wt.grid(axis='both', linestyle='--', linewidth=0.4, alpha=0.6)

        # MTF MACD 패널 렌더링
        if ax_macd is not None:
            for (tf_key, fast_len, slow_len, sig_len) in self.mtf_macd_settings:
                mtf_macd, mtf_sig, mtf_hist = self.get_mtf_macd_for_df(plot_df, tf_key, fast_len, slow_len, sig_len)
                if mtf_macd is None or mtf_macd.isna().all():
                    continue
                ax_macd.plot(x_nums, mtf_macd.values, color='#2196f3', linewidth=1.2, label=f'MACD ({tf_key})')
                ax_macd.plot(x_nums, mtf_sig.values, color='#ff9800', linewidth=1.2, label=f'Signal ({tf_key})')
                
                hist_vals = mtf_hist.values
                hist_colors = np.where(hist_vals >= 0, '#26a69a', '#ef5350')
                ax_macd.bar(x_nums, hist_vals, width=bar_width, color=hist_colors, align='center', alpha=0.5)
                
                ax_macd.axhline(y=0, color='#888888', linewidth=0.5)
                ax_macd.set_ylabel(f'MTF MACD ({tf_key})', fontsize=8)
                ax_macd.legend(fontsize=7, loc='upper left')
                ax_macd.grid(axis='both', linestyle='--', linewidth=0.4, alpha=0.6)

        # Kalman MTF MACD 패널 렌더링
        if ax_kalman_macd is not None:
            for (tf_key, Q, R, fast_len, slow_len, sig_len) in self.kalman_mtf_macd_settings:
                k_macd, k_sig, k_hist = self.get_kalman_mtf_macd_for_df(
                    plot_df, tf_key, Q, R, fast_len, slow_len, sig_len)
                if k_macd is None or k_macd.isna().all():
                    continue
                ax_kalman_macd.plot(x_nums, k_macd.values, color='#7c4dff', linewidth=1.2,
                                   label=f'K-MACD ({tf_key})')
                ax_kalman_macd.plot(x_nums, k_sig.values, color='#ff6d00', linewidth=1.2,
                                   label=f'K-Signal ({tf_key})')

                hist_vals = k_hist.values
                hist_colors = np.where(hist_vals >= 0, '#26a69a', '#ef5350')
                ax_kalman_macd.bar(x_nums, hist_vals, width=bar_width,
                                   color=hist_colors, align='center', alpha=0.5)

                ax_kalman_macd.axhline(y=0, color='#888888', linewidth=0.5)
                ax_kalman_macd.set_ylabel(f'Kalman MACD ({tf_key})', fontsize=8)
                ax_kalman_macd.legend(fontsize=7, loc='upper left')
                ax_kalman_macd.grid(axis='both', linestyle='--', linewidth=0.4, alpha=0.6)

        # MTF Stoch RSI 패널 렌더링
        if ax_stoch_rsi is not None:
            for (tf_key, rsi_len, stoch_len, k_len, d_len, ob_level, os_level) in self.mtf_stoch_rsi_settings:
                k_line, d_line = self.get_mtf_stoch_rsi_for_df(plot_df, tf_key, rsi_len, stoch_len, k_len, d_len)
                if k_line is None or k_line.isna().all():
                    continue
                ax_stoch_rsi.plot(x_nums, k_line.values, color='#2196f3', linewidth=1.2, label=f'K ({tf_key})')
                ax_stoch_rsi.plot(x_nums, d_line.values, color='#ff9800', linewidth=1.2, label=f'D ({tf_key})')
                
                # Overbought / Oversold zones
                ax_stoch_rsi.axhline(y=ob_level, color='#ef5350', linestyle='--', linewidth=0.8, alpha=0.7)
                ax_stoch_rsi.axhline(y=os_level, color='#26a69a', linestyle='--', linewidth=0.8, alpha=0.7)
                
                valid = ~np.isnan(k_line.values)
                ax_stoch_rsi.fill_between(x_nums, k_line.values, ob_level, where=valid & (k_line.values >= ob_level), color='#ef5350', alpha=0.2)
                ax_stoch_rsi.fill_between(x_nums, k_line.values, os_level, where=valid & (k_line.values <= os_level), color='#26a69a', alpha=0.2)
                
                ax_stoch_rsi.set_ylim(-5, 105)
                ax_stoch_rsi.set_ylabel(f'Stoch RSI ({tf_key})', fontsize=8)
                ax_stoch_rsi.legend(fontsize=7, loc='upper left')
                ax_stoch_rsi.grid(axis='both', linestyle='--', linewidth=0.4, alpha=0.6)

        # 사용자 맞춤형 X축 날짜/시간 포매터 정의
        import matplotlib.ticker as ticker
        class CustomDateFormatter(ticker.Formatter):
            def __call__(self, x, pos=0):
                try:
                    dt = mdates.num2date(x)
                    if dt.month == 1 and dt.day == 1 and dt.hour == 0 and dt.minute == 0:
                        return f"$\\mathbf{{{dt.strftime('%Y')}}}$"
                    elif dt.day == 1 and dt.hour == 0 and dt.minute == 0:
                        month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                        return f"$\\mathbf{{{month_names[dt.month]}}}$"
                    elif dt.hour == 0 and dt.minute == 0:
                        return f"$\\mathbf{{{dt.strftime('%d')}}}$"
                    else:
                        return dt.strftime('%H:%M')
                except Exception:
                    return ""

        # Collect all active sub-axes in order
        sub_axes = []
        if ax_slope is not None:
            sub_axes.append(ax_slope)
        if ax_sqz is not None:
            sub_axes.append(ax_sqz)
        if ax_wt is not None:
            sub_axes.append(ax_wt)
        if ax_macd is not None:
            sub_axes.append(ax_macd)
        if ax_kalman_macd is not None:
            sub_axes.append(ax_kalman_macd)
        if ax_stoch_rsi is not None:
            sub_axes.append(ax_stoch_rsi)
            
        import matplotlib.pyplot as plt
        
        # Hide x ticks on main ax if we have any sub_axes
        if sub_axes:
            plt.setp(ax.get_xticklabels(), visible=False)
            
            # Hide x ticks on all sub_axes except the last one
            for sub_ax in sub_axes[:-1]:
                plt.setp(sub_ax.get_xticklabels(), visible=False)
                
            # The bottom-most axis gets the date formatting
            bottom_ax = sub_axes[-1]
            bottom_ax.xaxis.set_major_locator(mdates.AutoDateLocator())
            bottom_ax.xaxis.set_major_formatter(CustomDateFormatter())
            bottom_ax.format_xdata = mdates.DateFormatter('%Y-%m-%d %H:%M')
        else:
            # If no subplots, format the main axis
            ax.xaxis.set_major_locator(mdates.AutoDateLocator())
            ax.xaxis.set_major_formatter(CustomDateFormatter())
            ax.format_xdata = mdates.DateFormatter('%Y-%m-%d %H:%M')

        self.update_marker_sizes(ax)

        self.fig.tight_layout()
        self.canvas.draw()
        
    def zoom_chart(self, event):
        # 차트 영역 안에서 발생한 스크롤이 아니면 무시
        if event.inaxes is None:
            return
            
        ax = event.inaxes
        
        # 확대/축소 비율 (한 번 틱에 10% 증감)
        base_scale = 1.1
        if event.step > 0:
            scale = 1 / base_scale # 위로 굴리면 확대
        else:
            scale = base_scale     # 아래로 굴리면 축소
            
        # 파이썬 내장 이벤트 대신 Qt(GUI)에서 직접 현재 키보드 상태(컨트롤 키 눌림 여부)를 감지합니다.
        modifiers = QApplication.keyboardModifiers()
        
        # 컨트롤 키를 누른 상태에서는 세로축(Y축)을 확대/축소
        if modifiers & Qt.ControlModifier:
            ylim = ax.get_ylim()
            ydata = event.ydata
            # Y좌표(가격)를 중심으로 상하 재계산
            new_bottom = ydata - (ydata - ylim[0]) * scale
            new_top = ydata + (ylim[1] - ydata) * scale
            ax.set_ylim([new_bottom, new_top])
        else:
            xlim = ax.get_xlim()
            xdata = event.xdata
            # 마우스가 위치한 곳(xdata)을 기준으로 중심을 잡고 좌우(X축) 좌표 재계산
            new_left = xdata - (xdata - xlim[0]) * scale
            new_right = xdata + (xlim[1] - xdata) * scale
            ax.set_xlim([new_left, new_right])
            
        self.update_marker_sizes(ax)
        self.canvas.draw()
        
    def on_press(self, event):
        if event.inaxes is None:
            return
            
        # 1. 더블 클릭 -> 차트/표 동기화 핸들러로 우회
        if event.dblclick:
            self.handle_double_click(event)
            
        # 2. 좌클릭 단일 누르기 -> 드래그(Pan) 모드 활성화
        elif event.button == 1:
            # 툴바(기본 줌,팬)가 활성화 중일 때는 충돌을 막기 위해 무시
            if hasattr(self, 'toolbar') and self.toolbar.mode != '':
                return
            self._dragging = True
            self._drag_x_start = event.x
            self._drag_y_start = event.y
            self._orig_xlim = event.inaxes.get_xlim()
            self._orig_ylim = event.inaxes.get_ylim()

    def on_motion(self, event):
        if getattr(self, '_dragging', False) and event.inaxes:
            ax = event.inaxes
            
            # 마우스 픽셀 변화량
            dx_px = event.x - self._drag_x_start
            dy_px = event.y - self._drag_y_start
            
            x0, x1 = self._orig_xlim
            y0, y1 = self._orig_ylim
            
            # 현재 창 크기에 맞추어 좌표 변환 (해상도 비례 팬 속도)
            bbox = ax.get_window_extent()
            dx_data = dx_px / bbox.width * (x1 - x0)
            dy_data = dy_px / bbox.height * (y1 - y0)
            
            # 마우스를 끈 방향으로 차트 이동 (반대 단위로 리미트 이동)
            ax.set_xlim([x0 - dx_data, x1 - dx_data])
            ax.set_ylim([y0 - dy_data, y1 - dy_data])
            self.update_marker_sizes(ax)
            self.canvas.draw_idle()

    def on_release(self, event):
        if event.button == 1:
            self._dragging = False

    def update_marker_sizes(self, ax):
        xlim = ax.get_xlim()
        # 현재 화면에 보이는 캔들 개수(x축 범위)
        visible_candles = max(1, xlim[1] - xlim[0])
        # 화살표가 지금도 너무 커서 다시 10분의 1 수준(기초 대비 1/100)으로 대폭 하향
        new_size = max(0.1, min(20, 50 / visible_candles))
        
        import matplotlib.collections as mcoll
        for collection in ax.collections:
            # mpf.make_addplot으로 추가된 scatter 객체(화살표 마커)의 크기 조절
            if isinstance(collection, mcoll.PathCollection):
                collection.set_sizes([new_size])

    def handle_double_click(self, event):
        if not hasattr(self, 'current_df') or self.current_df.empty:
            return
            
        import matplotlib.dates as mdates
        try:
            # 클릭한 X축 좌표를 변환하고 naive datetime으로 맞춤 (표 데이터 시간과 동일하게 만들기 위함)
            clicked_dt = mdates.num2date(event.xdata)
            clicked_ts = pd.Timestamp(clicked_dt).tz_localize(None)
            
            # 현재 표시된 데이터프레임에서 가장 가까운 시점의 행(row)을 찾습니다.
            time_diffs = abs(self.current_df['timestamp'] - clicked_ts)
            closest_idx = time_diffs.idxmin()
            
            # 선택한 표의 행에 하이라이트를 주고 중앙으로 스크롤 이동
            self.table.selectRow(closest_idx)
            item = self.table.item(closest_idx, 0)
            if item:
                self.table.scrollToItem(item, QAbstractItemView.PositionAtCenter)
                # 차트를 더블클릭했을 때도 표를 더블클릭한 것과 똑같이 움직이도록 강제 호출해 세로선을 옮겨줌
                self.on_table_double_click(item)
        except Exception as e:
            print("Error navigating to row:", e)

    def on_table_double_click(self, item):
        if not hasattr(self, 'current_df') or self.current_df.empty:
            return
            
        row_idx = item.row()
        if row_idx < 0 or row_idx >= len(self.current_df):
            return
            
        target_ts = self.current_df.iloc[row_idx]['timestamp']
        
        # 차트의 메인 축 가져오기
        if not self.fig.axes:
            return
        ax = self.fig.axes[0]
        
        import matplotlib.dates as mdates
        # 타임스탬프를 matplotlib 수치좌표로 변환
        x_val = mdates.date2num(target_ts)
        
        # 이전에 그려둔 하이라이트 세로선이 있다면 안전하게 제거
        if hasattr(self, 'highlight_vline') and self.highlight_vline in ax.lines:
            try:
                self.highlight_vline.remove()
            except Exception:
                pass
            
        # 캔들 뒤(zorder=0)에 그려지는 보통 굵기의 회색 점선으로 해당 캔들을 마킹
        self.highlight_vline = ax.axvline(x=x_val, color='gray', linestyle='--', linewidth=1.5, alpha=0.8, zorder=0)
        self.canvas.draw()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    
    # 전체 폰트 크기를 기존 설정의 절반 수준으로 줄이기
    font = app.font()
    if font.pointSize() > 0:
        font.setPointSizeF(font.pointSizeF() * 1.2)
    elif font.pixelSize() > 0:
        font.setPixelSize(int(font.pixelSize() * 1.2))
    else:
        font.setPointSize(8)
    app.setFont(font)
    
    window = BinanceDataFetcher()
    window.show()
    sys.exit(app.exec())
