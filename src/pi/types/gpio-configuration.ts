/**
 * GPIOConfiguration Interface
 * 
 * Defines GPIO pin configurations and protocol settings for Raspberry Pi
 * hardware interface management.
 */

export interface GPIOConfiguration {
  /** GPIO pin configurations */
  pins: {
    [pin: number]: {
      /** Pin mode configuration */
      mode: 'input' | 'output' | 'pwm' | 'i2c' | 'spi' | 'uart';
      /** Enable internal pull-up resistor */
      pullup?: boolean;
      /** Interrupt trigger configuration */
      interrupt?: 'rising' | 'falling' | 'both';
      /** Optional description for documentation */
      description?: string;
    };
  };
  
  /** Communication protocol configurations */
  protocols: {
    /** I2C protocol configuration */
    i2c?: {
      /** Whether I2C is enabled */
      enabled: boolean;
      /** I2C bus frequency in Hz */
      frequency: number;
    };
    
    /** SPI protocol configuration */
    spi?: {
      /** Whether SPI is enabled */
      enabled: boolean;
      /** SPI communication speed in Hz */
      speed: number;
    };
    
    /** UART protocol configuration */
    uart?: {
      /** Whether UART is enabled */
      enabled: boolean;
      /** UART baud rate */
      baudRate: number;
    };
  };
}