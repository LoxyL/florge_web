document.addEventListener('contextmenu', (event)=>{
    event.preventDefault();
})

// 窗口切换功能
document.addEventListener('DOMContentLoaded', () => {
    // 获取所有单选按钮
    const radioInputs = document.querySelectorAll('.function-select-bar input[type="radio"]');
    
    // 获取已有的窗口
    const windows = [
        document.querySelector('.GPT-window'),
        document.querySelector('.painter-window')
        // 注意：HTML中目前没有audio-window和flow-window，需要添加
    ];
    
    // 创建缺少的窗口元素
    const audioWindow = document.createElement('div');
    audioWindow.className = 'audio-window';
    audioWindow.innerHTML = `
        <div class="audio-window-content">
            <h2 class="window-title">音频功能</h2>
            <p class="window-placeholder">音频功能正在开发中...</p>
        </div>
    `;
    document.body.appendChild(audioWindow);
    
    const flowWindow = document.createElement('div');
    flowWindow.className = 'flow-window';
    flowWindow.innerHTML = `
        <div class="flow-window-content">
            <h2 class="window-title">流程图功能</h2>
            <p class="window-placeholder">流程图功能正在开发中...</p>
        </div>
    `;
    document.body.appendChild(flowWindow);
    
    // 更新窗口数组
    windows.push(audioWindow, flowWindow);
    
    // 为每个单选按钮添加change事件监听器
    radioInputs.forEach(radio => {
        radio.addEventListener('change', () => {
            showSelectedWindow(radio.id);
        });
    });
    
    // 初始状态：显示第一个窗口（GPT窗口），隐藏其他窗口
    showSelectedWindow('GPT');
    
    // 根据选中的单选按钮ID显示对应窗口
    function showSelectedWindow(selectedId) {
        const windowMap = {
            'GPT': 0,
            'painter': 1,
            'audio': 2,
            'flow': 3
        };
        
        const selectedIndex = windowMap[selectedId];
        
        // 显示选中的窗口，隐藏其他窗口
        windows.forEach((window, index) => {
            if (window) {
                if (index === selectedIndex) {
                    window.style.display = 'flex'; // 使用flex布局显示
                } else {
                    window.style.display = 'none';
                }
            }
        });
    }
});